import { describe, test, expect, vi } from "vitest";
import { createMeasureScheduler, SKIP } from "./measure";

/** A hand-cranked frame clock, so a test can say "one frame passed". */
function fakeFrames() {
  let next = 1;
  const booked = new Map<number, () => void>();
  return {
    raf: (cb: () => void) => {
      const id = next++;
      booked.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      booked.delete(id);
    },
    /** Run whatever is booked, as a browser would at the next paint. */
    tick() {
      const due = Array.from(booked.values());
      booked.clear();
      for (const cb of due) cb();
    },
    get bookedCount() {
      return booked.size;
    },
  };
}

describe("measure scheduler", () => {
  test("N requests in one frame produce exactly one measurement", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const read = vi.fn(() => 1);
    const write = vi.fn();
    const h = s.add({ read, write });

    for (let i = 0; i < 50; i++) h.request();
    expect(read).not.toHaveBeenCalled();
    expect(f.bookedCount).toBe(1);

    f.tick();
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("the last value wins", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    let viewport = 0;
    const seen: number[] = [];
    const h = s.add<number>({ read: () => viewport, write: (v) => seen.push(v) });

    // A resize storm: many events, several frames, ending on 900.
    for (const w of [100, 200, 300]) {
      viewport = w;
      h.request();
    }
    f.tick();
    for (const w of [400, 500, 900]) {
      viewport = w;
      h.request();
    }
    f.tick();

    // Two frames, two measurements, and the settled value is kept.
    expect(seen).toEqual([300, 900]);
    expect(seen[seen.length - 1]).toBe(viewport);
  });

  test("a value equal to the last one written is not written again", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const write = vi.fn();
    const h = s.add({ read: () => 42, write });

    h.request();
    f.tick();
    h.request();
    f.tick();
    h.request();
    f.tick();
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("equals is honoured, so a structural value can bail too", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const write = vi.fn();
    const h = s.add<{ w: number }>({
      read: () => ({ w: 10 }),
      write,
      equals: (a, b) => a.w === b.w,
    });
    h.request();
    f.tick();
    h.request();
    f.tick();
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("equals: () => false writes every pass, for a write that bails itself", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const write = vi.fn();
    const h = s.add({ read: () => 7, write, equals: () => false });
    h.request();
    f.tick();
    h.request();
    f.tick();
    expect(write).toHaveBeenCalledTimes(2);
  });

  test("SKIP leaves the state untouched and does not poison the cache", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const write = vi.fn();
    let detached = true;
    const h = s.add<number>({ read: () => (detached ? SKIP : 5), write });

    h.request();
    f.tick();
    expect(write).not.toHaveBeenCalled();

    detached = false;
    h.request();
    f.tick();
    expect(write).toHaveBeenCalledWith(5);
  });

  test("every read in a pass runs before any write", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const order: string[] = [];
    const a = s.add({ read: () => (order.push("read-a"), 1), write: () => order.push("write-a") });
    const b = s.add({ read: () => (order.push("read-b"), 2), write: () => order.push("write-b") });
    const c = s.add({ read: () => (order.push("read-c"), 3), write: () => order.push("write-c") });
    a.request();
    b.request();
    c.request();
    f.tick();
    expect(order).toEqual(["read-a", "read-b", "read-c", "write-a", "write-b", "write-c"]);
  });

  test("teardown cancels a pending pass", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const read = vi.fn(() => 1);
    const write = vi.fn();
    const h = s.add({ read, write });

    h.request();
    expect(s.isPending()).toBe(true);
    h.release();
    expect(s.isPending()).toBe(false);
    expect(f.bookedCount).toBe(0);

    f.tick();
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    // And a request after release is inert.
    h.request();
    f.tick();
    expect(read).not.toHaveBeenCalled();
  });

  test("one task's teardown does not cancel another's pending pass", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const writeA = vi.fn();
    const writeB = vi.fn();
    const a = s.add({ read: () => 1, write: writeA });
    const b = s.add({ read: () => 2, write: writeB });
    a.request();
    b.request();
    a.release();
    f.tick();
    expect(writeA).not.toHaveBeenCalled();
    expect(writeB).toHaveBeenCalledTimes(1);
  });

  test("measureNow reads immediately and consumes the pending request", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    const read = vi.fn(() => 3);
    const write = vi.fn();
    const h = s.add({ read, write });

    h.request();
    h.measureNow();
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(3);
    expect(s.isPending()).toBe(false);

    f.tick();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("a request during a pass is deferred to the next frame, not dropped", () => {
    const f = fakeFrames();
    const s = createMeasureScheduler(f.raf, f.caf);
    let value = 1;
    const seen: number[] = [];
    const h = s.add<number>({
      read: () => value,
      write: (v) => {
        seen.push(v);
        // A write that re-renders can knock layout about, so a task is allowed
        // to ask for another look. That must land next frame.
        if (seen.length === 1) {
          value = 2;
          h.request();
        }
      },
    });
    h.request();
    f.tick();
    expect(seen).toEqual([1]);
    f.tick();
    expect(seen).toEqual([1, 2]);
  });
});
