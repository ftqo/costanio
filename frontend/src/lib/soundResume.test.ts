import { test, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Lifting the entry screen's hold must not drop the cues raised behind it.
 *
 * `setAudioHeld(false)` asks for an asynchronous resume and returns; the game
 * screen then fires the opening cue and, for the first player, the turn cue,
 * while the context is still `suspended`. `play` must wait on that resume
 * rather than drop them.
 *
 * Each test loads a fresh module (`resetModules`) because it caches one
 * AudioContext for the life of the process.
 */

/** A context whose resume can be resolved on demand, so the race is explicit. */
class DeferredCtx {
  state: AudioContextState = "suspended";
  currentTime = 0;
  destination = {};
  started: number[] = [];
  private release: (() => void) | null = null;

  addEventListener() {}
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    return new Promise<void>((res) => {
      this.release = () => {
        this.state = "running";
        res();
      };
    });
  }
  /** Let the pending resume land, then drain the microtasks it unblocks. */
  async settle() {
    this.release?.();
    this.release = null;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 1 } as AudioBuffer);
  }
  createGain() {
    return { gain: { value: 0 }, connect: () => ({ connect: () => {} }) };
  }
  createBufferSource() {
    const self = this;
    return {
      buffer: null as AudioBuffer | null,
      playbackRate: { value: 1 },
      connect: () => ({ connect: () => {} }),
      start(at: number) {
        self.started.push(at);
      },
    };
  }
}

let ctx: DeferredCtx;

beforeEach(() => {
  vi.resetModules();
  ctx = new DeferredCtx();
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    ),
  );
  vi.stubGlobal("AudioContext", function () {
    return ctx;
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Load the module fresh and get a decoded buffer in place for the cue. */
async function armed() {
  const sound = await import("./sound");
  sound.setMuted(false);
  sound.preload(["sound_start", "sound_turn"]);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return sound;
}

test("a cue raised during the hold's resume plays once it lands", async () => {
  const sound = await armed();
  sound.setAudioHeld(true);
  sound.setAudioHeld(false); // asks for a resume; the clock is still stopped

  expect(ctx.state).toBe("suspended");
  sound.play("sound_start");
  // Nothing yet: scheduling against a stopped clock is never allowed.
  expect(ctx.started).toHaveLength(0);

  await ctx.settle();
  // It waited on the resume.
  expect(ctx.started).toHaveLength(1);
});

test("the start and turn cues both play, in order", async () => {
  const sound = await armed();
  sound.setAudioHeld(true);
  sound.setAudioHeld(false);

  // The opening and turn cues fire together: the first player's turn begins
  // as the game does.
  sound.play("sound_start");
  sound.play("sound_turn", { afterCue: true });
  expect(ctx.started).toHaveLength(0);

  await ctx.settle();
  expect(ctx.started).toHaveLength(2);
  // In order, with the turn cue after the opening one.
  expect(ctx.started[1]).toBeGreaterThanOrEqual(ctx.started[0]);
});

test("a hit on a stopped clock with no resume pending is dropped", async () => {
  const sound = await armed();
  // No hold was lifted, so nothing is in flight: the autoplay-policy case,
  // where the hit is dropped and the gesture path armed.
  expect(ctx.state).toBe("suspended");
  sound.play("sound_start");
  await Promise.resolve();
  await Promise.resolve();
  expect(ctx.started).toHaveLength(0);
});

test("mute silences a waiting cue", async () => {
  const sound = await armed();
  sound.setAudioHeld(true);
  sound.setAudioHeld(false);
  sound.play("sound_start");
  // Muting before the resume lands must silence it: the wait re-enters
  // `play`, which re-checks the whole gate.
  sound.setMuted(true);
  await ctx.settle();
  expect(ctx.started).toHaveLength(0);
  sound.setMuted(false);
});
