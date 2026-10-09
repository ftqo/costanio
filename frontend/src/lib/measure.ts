import * as React from "react";

/**
 * Frame-coalesced layout measurement.
 *
 * A window drag fires `resize` 40-70 times a second. Components that each
 * listen, measure and `setState` force a reflow and a render per event.
 * Debouncing would make the UI lag the window, so instead measurements are
 * coalesced: one pass per animation frame, all reads before any write. Batched
 * reads do not invalidate each other, and writes in one rAF callback become one
 * React render.
 *
 * The scheduler has no React dependency so it can be tested with a fake clock;
 * the hooks at the bottom wrap it.
 */

/** Returned by a `read` that has nothing to report (the node is gone, or the
 *  environment cannot measure). The pass then leaves the state untouched. */
export const SKIP = Symbol("measure.skip");

export type MeasureTask<T> = {
  /** Pure layout read. Runs in the read phase; must not write to the DOM. */
  read: () => T | typeof SKIP;
  /** Applies the value. Runs in the write phase, after every read in the pass. */
  write: (value: T) => void;
  /**
   * Whether a new value is the same as the last one written, in which case the
   * write is skipped. Defaults to `Object.is`. Pass `() => false` to write every
   * time (for a `write` that does its own bail).
   */
  equals?: (a: T, b: T) => boolean;
};

export type MeasureHandle = {
  /** Ask for a pass on the next frame. Calls within one frame collapse into one. */
  request(): void;
  /** Read and write straight away, outside the frame. Keeps the cache honest for
   *  callers that also measure synchronously (mount, scroll). */
  measureNow(): void;
  /** Unregister. Cancels this task's share of a pending pass. */
  release(): void;
};

export type MeasureScheduler = {
  add<T>(task: MeasureTask<T>): MeasureHandle;
  /** Run the pending pass now. Tests use it as a fake frame. */
  flush(): void;
  /** Whether a frame is booked but has not run. */
  isPending(): boolean;
};

type Entry = {
  task: MeasureTask<unknown>;
  last: unknown;
  has: boolean;
  live: boolean;
};

const defaultRaf = (cb: () => void): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(() => cb())
    : (setTimeout(cb, 16) as unknown as number);

const defaultCaf = (h: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(h);
  else clearTimeout(h as unknown as ReturnType<typeof setTimeout>);
};

export function createMeasureScheduler(
  raf: (cb: () => void) => number = defaultRaf,
  caf: (handle: number) => void = defaultCaf,
): MeasureScheduler {
  const queued = new Set<Entry>();
  let frame: number | null = null;

  const commit = (e: Entry, value: unknown) => {
    if (!e.live || value === SKIP) return;
    const eq = e.task.equals ?? Object.is;
    if (e.has && eq(e.last, value)) return;
    e.has = true;
    e.last = value;
    e.task.write(value);
  };

  const runPass = () => {
    frame = null;
    if (queued.size === 0) return;
    const due = Array.from(queued);
    queued.clear();
    // Read phase: every measurement first. A write in between would invalidate
    // layout and make the next read reflow.
    const values = due.map((e) => (e.live ? e.task.read() : SKIP));
    // Write phase. React batches these into one render.
    for (let i = 0; i < due.length; i++) commit(due[i], values[i]);
  };

  const book = () => {
    if (frame === null) frame = raf(runPass);
  };

  const unbook = () => {
    if (queued.size === 0 && frame !== null) {
      caf(frame);
      frame = null;
    }
  };

  return {
    add<T>(task: MeasureTask<T>): MeasureHandle {
      const e: Entry = {
        task: task as MeasureTask<unknown>,
        last: undefined,
        has: false,
        live: true,
      };
      return {
        request() {
          if (!e.live) return;
          queued.add(e);
          book();
        },
        measureNow() {
          if (!e.live) return;
          queued.delete(e);
          commit(e, e.task.read());
          unbook();
        },
        release() {
          e.live = false;
          queued.delete(e);
          unbook();
        },
      };
    },
    flush: runPass,
    isPending: () => frame !== null,
  };
}

/** The one every component shares, so a frame is one pass across the whole app. */
export const measureScheduler = createMeasureScheduler();

/**
 * One `resize` listener and one `ResizeObserver` for the whole app, attached
 * with the first subscriber and dropped with the last. The observer on
 * `<html>` catches what `resize` misses (zoom, a devtools split, a mobile URL
 * bar).
 *
 * The visual viewport is wired in too, for the on-screen keyboard, which
 * resizes nothing else. Its `resize` (keyboard) and `scroll` (pinch-zoom pan,
 * moving `offsetTop`) go through the same notifier and are coalesced per frame;
 * `scroll` fires every frame during a pinch.
 */
const viewportListeners = new Set<() => void>();
let detachViewport: (() => void) | null = null;

const notifyViewport = () => {
  for (const fn of Array.from(viewportListeners)) fn();
};

export function onViewportResize(fn: () => void): () => void {
  viewportListeners.add(fn);
  if (!detachViewport && typeof window !== "undefined") {
    window.addEventListener("resize", notifyViewport);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(notifyViewport);
      ro.observe(document.documentElement);
    }
    // Feature-detected: jsdom and some older webviews have no `visualViewport`.
    // Everything downstream falls back to the layout viewport.
    const vv = window.visualViewport ?? null;
    vv?.addEventListener("resize", notifyViewport);
    vv?.addEventListener("scroll", notifyViewport);
    detachViewport = () => {
      window.removeEventListener("resize", notifyViewport);
      vv?.removeEventListener("resize", notifyViewport);
      vv?.removeEventListener("scroll", notifyViewport);
      ro?.disconnect();
    };
  }
  return () => {
    viewportListeners.delete(fn);
    if (viewportListeners.size === 0 && detachViewport) {
      detachViewport();
      detachViewport = null;
    }
  };
}

/**
 * What the player can actually see, in layout pixels.
 *
 * `layoutH` is the box `position: fixed` lays out against; `visibleH` is the
 * part not under the keyboard (or outside a pinch zoom). `offsetTop` is how far
 * the visual viewport is scrolled down inside the layout one (non-zero only
 * while pinch-zoomed).
 *
 * A read, not a subscription: pair it with `onViewportResize`/`useMeasure` so it
 * runs inside the shared measurement pass.
 */
export type ViewportMetrics = { layoutH: number; visibleH: number; offsetTop: number };

export function readViewportMetrics(): ViewportMetrics {
  if (typeof window === "undefined") return { layoutH: 0, visibleH: 0, offsetTop: 0 };
  const layoutH = window.innerHeight || 0;
  const vv = window.visualViewport;
  if (!vv) return { layoutH, visibleH: layoutH, offsetTop: 0 };
  return { layoutH, visibleH: vv.height, offsetTop: vv.offsetTop };
}

/** Test seam: how many subscribers the shared viewport source currently has. */
export function viewportSubscriberCount(): number {
  return viewportListeners.size;
}

export type UseMeasureOptions<T> = MeasureTask<T> & {
  /**
   * Also re-measure when this element's own box changes, not just the window's.
   * Read once, when the subscription is set up.
   */
  observe?: React.RefObject<Element | null>;
  /** Re-subscribe and re-measure when these change. Fixed length, as ever. */
  deps?: React.DependencyList;
};

/**
 * Measure layout on viewport resize, at most once per animation frame.
 *
 * Measures once synchronously on mount (and on any `deps` change), so the first
 * value needs no frame; afterwards each resize only marks the task due.
 */
export function useMeasure<T>({ read, write, equals, observe, deps }: UseMeasureOptions<T>): void {
  // Latest-callback refs, so a re-render does not resubscribe.
  const readRef = React.useRef(read);
  const writeRef = React.useRef(write);
  const equalsRef = React.useRef(equals);
  // Refreshed in the layout phase, which runs before the rAF measurement pass
  // and before the subscribing effect on mount, so a pass never sees a stale
  // closure.
  React.useLayoutEffect(() => {
    readRef.current = read;
    writeRef.current = write;
    equalsRef.current = equals;
  });

  React.useEffect(() => {
    const handle = measureScheduler.add<T>({
      read: () => readRef.current(),
      write: (v) => writeRef.current(v),
      equals: (a, b) => (equalsRef.current ?? Object.is)(a, b),
    });
    handle.measureNow();
    const request = () => handle.request();
    const off = onViewportResize(request);
    let ro: ResizeObserver | null = null;
    const el = observe?.current ?? null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(request);
      ro.observe(el);
    }
    return () => {
      off();
      ro?.disconnect();
      handle.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? []);
}
