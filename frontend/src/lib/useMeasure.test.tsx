import { describe, test, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useMeasure, measureScheduler, viewportSubscriberCount, SKIP } from "./measure";

// The hook rides the app-wide scheduler, whose frames are real rAFs. `flush()`
// stands in for the frame so a test never has to wait for paint.
const frame = () => act(() => measureScheduler.flush());

/** Fire a resize storm the way a window drag does: many events, no frame between. */
function storm(n: number) {
  act(() => {
    for (let i = 0; i < n; i++) window.dispatchEvent(new Event("resize"));
  });
}

let mounted: { root: Root; container: HTMLElement }[] = [];

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const { root, container } of mounted) {
    act(() => root.unmount());
    container.remove();
  }
  mounted = [];
  expect(viewportSubscriberCount()).toBe(0);
});

describe("useMeasure", () => {
  test("many resize events cost one measurement and render per frame", () => {
    const read = vi.fn(() => window.innerWidth);
    const renders = vi.fn();

    function Probe() {
      const [w, setW] = React.useState(0);
      renders();
      useMeasure<number>({ read, write: setW });
      return <span>{w}</span>;
    }

    const el = mount(<Probe />);
    // Mount measures synchronously, so nothing waits a frame for its first value.
    expect(read).toHaveBeenCalledTimes(1);
    const rendersAfterMount = renders.mock.calls.length;

    (window as { innerWidth: number }).innerWidth = 1200;
    storm(200);
    // None of the 200 events did any work.
    expect(read).toHaveBeenCalledTimes(1);

    frame();
    expect(read).toHaveBeenCalledTimes(2);
    expect(el.textContent).toBe("1200");
    // One extra render for all of them.
    expect(renders.mock.calls.length).toBe(rendersAfterMount + 1);
  });

  test("keeps the settled value", () => {
    function Probe() {
      const [w, setW] = React.useState(0);
      useMeasure<number>({ read: () => window.innerWidth, write: setW });
      return <span>{w}</span>;
    }
    const el = mount(<Probe />);

    // Drag: sizes flicker past, then stop.
    for (const w of [800, 812, 907, 1033, 1440]) {
      (window as { innerWidth: number }).innerWidth = w;
      storm(9);
    }
    frame();
    expect(el.textContent).toBe("1440");
  });

  test("an unchanged measurement does not re-render", () => {
    const renders = vi.fn();
    function Probe() {
      const [w, setW] = React.useState(0);
      renders();
      useMeasure<number>({ read: () => 640, write: setW });
      return <span>{w}</span>;
    }
    mount(<Probe />);
    const before = renders.mock.calls.length;
    storm(50);
    frame();
    storm(50);
    frame();
    expect(renders.mock.calls.length).toBe(before);
  });

  test("SKIP leaves the state alone", () => {
    function Probe({ ready }: { ready: boolean }) {
      const [w, setW] = React.useState(-1);
      useMeasure<number>({ read: () => (ready ? 5 : SKIP), write: setW, deps: [ready] });
      return <span>{w}</span>;
    }
    const el = mount(<Probe ready={false} />);
    storm(3);
    frame();
    expect(el.textContent).toBe("-1");
  });

  test("unmount cancels a pending pass and drops the listener", () => {
    const read = vi.fn(() => 1);
    function Probe() {
      const [, setW] = React.useState(0);
      useMeasure<number>({ read, write: setW });
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(viewportSubscriberCount()).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);

    storm(10);
    act(() => root.unmount());
    container.remove();
    expect(viewportSubscriberCount()).toBe(0);

    frame();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("many components share one resize listener and one frame", () => {
    const reads: number[] = [];
    function Probe({ id }: { id: number }) {
      const [, setW] = React.useState(0);
      useMeasure<number>({
        read: () => {
          reads.push(id);
          return window.innerWidth + id;
        },
        write: setW,
      });
      return null;
    }
    mount(
      <>
        <Probe id={1} />
        <Probe id={2} />
        <Probe id={3} />
        <Probe id={4} />
        <Probe id={5} />
      </>,
    );
    // The app installs one `resize` listener however many measurers there
    // are; this counts the subscriber list behind it.
    expect(viewportSubscriberCount()).toBe(5);

    reads.length = 0;
    (window as { innerWidth: number }).innerWidth = 999;
    storm(120);
    expect(reads).toEqual([]);
    frame();
    expect(reads).toEqual([1, 2, 3, 4, 5]);
  });

  /**
   * A late-mounting node must be named in `deps`. `observe` is read once, when
   * the subscription is taken; taken while the ref is null, it finds no element
   * to observe and only a window resize would wake it. The game screen mounts
   * its HUD after a loading state, so without `deps` the seat rail's
   * `railFrac` stayed 0 and the camera never inset for the rail.
   */
  function LateBox({ show, seen }: { show: boolean; seen: number[] }) {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const [el, setEl] = React.useState<HTMLDivElement | null>(null);
    const attach = React.useCallback((node: HTMLDivElement | null) => {
      ref.current = node;
      setEl(node);
    }, []);
    useMeasure<number>({
      read: () => (ref.current ? 42 : SKIP),
      write: (n) => seen.push(n),
      observe: ref,
      deps: [el],
    });
    return show ? <div ref={attach} /> : null;
  }

  /** `mount`, but the root comes back so the test can re-render on it. */
  function mountRoot(node: React.ReactNode): Root {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(node));
    mounted.push({ root, container });
    return root;
  }

  test("a box that mounts after its measurement is still measured", () => {
    const seen: number[] = [];
    const root = mountRoot(<LateBox show={false} seen={seen} />);
    // Nothing to read yet, and nothing written.
    expect(seen).toEqual([]);

    // The later commit mounts the node. No resize and no frame: naming it in
    // `deps` re-takes the subscription, which measures synchronously.
    act(() => root.render(<LateBox show seen={seen} />));
    expect(seen.at(-1)).toBe(42);
  });

  test("an unmounted box keeps its last measurement", () => {
    const seen: number[] = [];
    const root = mountRoot(<LateBox show seen={seen} />);
    expect(seen.at(-1)).toBe(42);
    const before = seen.length;
    act(() => root.render(<LateBox show={false} seen={seen} />));
    // The re-subscription reads a null ref and skips, so the last good value
    // stands rather than a zero for a box that is not there.
    expect(seen.length).toBe(before);
  });
});
