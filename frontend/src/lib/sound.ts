// The sound set is small: game start, your turn, one placement thunk, dice,
// and a seven. Cards, trades and chat stay silent, since a turn fires many
// events. Moving a marker (robber, pirate, merchant) reuses the placement
// sample a tenth lower.
//
// Effects use WebAudio rather than HTMLAudioElement so one placement sample can
// be pitch-shifted per piece, dice jittered per roll, and hits overlap without
// cutting each other off. Music stays on an <audio> element: it is a long
// streaming loop, not worth decoding into memory.

import { assetURL } from "./assets";

let muted = true;
let master = 0.8; // 0..1 master gain (the in-game Volume slider)
export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

/**
 * The entry hold: silence while the loading screen is up.
 *
 * The board mounts behind the entry screen, so events (even the game start)
 * can arrive before the player sees the table. A hold is separate from mute:
 * mute is the player's remembered choice, the hold is the screen's and lasts
 * seconds. The two are ORed in the gate.
 *
 * It suspends the context as well as dropping cues, which also covers the
 * music element. Held hits are dropped, never queued, so a load does not empty
 * into the first second of the game. On release the game screen re-arms its
 * cue anchors (see routes/Game), so a game that started behind the screen
 * sounds its opening cue as the board appears.
 */
let held = false;

/**
 * The resume started by lifting a hold, while it is still in flight.
 *
 * `AudioContext.resume()` is asynchronous, and `play` drops hits fired at a
 * stopped clock, so the opening cue and first turn cue (raised the instant the
 * entry screen comes down) would be lost. Hits raised after the gate opens wait
 * on this. That is a few milliseconds, not the backlog the hold refuses, and
 * spacing and burst limits still apply.
 */
let resuming: Promise<void> | null = null;

export function setAudioHeld(h: boolean) {
  if (held === h) return;
  held = h;
  if (held) {
    stopMusic();
    void ctx?.suspend().catch(() => {});
    return;
  }
  // The clock stopped and restarted, so pacing timestamps are stale.
  resetPacing();
  if (ctx?.state === "suspended") {
    // Kept so a cue raised before this lands can wait for it. Cleared either
    // way, so a refused resume leaves nothing waiting.
    const done = () => {
      if (resuming === pending) resuming = null;
    };
    const pending: Promise<void> = ctx.resume().then(done, done);
    resuming = pending;
  }
  refreshMusic();
}
export function isAudioHeld() {
  return held;
}
export function setVolume(v: number) {
  master = Math.min(1, Math.max(0, v));
  refreshMusicVolume();
}

/**
 * A tenth lower in pitch, in semitones: the interval whose playback rate is
 * exactly 0.9.
 */
const DOWN_A_TENTH = 12 * Math.log2(0.9);

/**
 * Semitone offset per event, all sharing the `sound_place` sample: bigger
 * piece, higher pitch. Roads and ships share an offset.
 *
 * Markers (robber, pirate, merchant) sit a tenth below: a move, not a
 * purchase. The pirate is the robber's move on water.
 */
const PLACE_SEMITONES: Record<string, number> = {
  robber_moved: DOWN_A_TENTH,
  pirate_moved: DOWN_A_TENTH,
  cak_merchant_placed: DOWN_A_TENTH,
  road_built: -1,
  road_placed: -1,
  ship_built: -1,
  ship_moved: -1,
  settlement_built: 0,
  settlement_placed: 0,
  city_built: 2,
  setup_city_placed: 2,
  // Medicine's discounted upgrade (engine/knights EvCheapCity): a settlement
  // became a city, so it gets the city's cue.
  cak_cheap_city: 2,
  cak_wall_built: -2,
  cak_knight_built: 3,
  cak_knight_promoted: 5,
  cak_metropolis: 4,
};

export type EventSound = { slot: string; semitones: number; gain?: number };

/**
 * Map a game-event type to a sound, or null for the many silent events.
 *
 * Cues that depend on more than the type are handled elsewhere: `dice_rolled`
 * (seven or not), `cak_barbarian_attack` (the skipped first landfall uses the
 * same type), `cak_improved` (`improveSound`), `cak_knights_all_active`
 * (`warlordSound`), and the start cue, which depends on the log a client
 * arrives with.
 *
 * Smith emits one `cak_knight_promoted` per knight; the caller drops the echo
 * (see `isRepeatPromotion`).
 */
export function eventSound(ev: string): EventSound | null {
  const semis = PLACE_SEMITONES[ev];
  if (semis !== undefined) return { slot: "sound_place", semitones: semis };
  // Its own sound: readying a knight builds nothing, and is easy to miss on a
  // piece already on the board. The burst limiter spaces a multi-knight
  // refresh.
  if (ev === "cak_knight_activated") return { slot: "sound_knight_ready", semitones: 0 };
  return null;
}

/**
 * Warlord: the knight-ready cue, sounded once for the card. Warlord wakes every
 * inactive knight in one `cak_knights_all_active` event, so there is no
 * per-knight event to hear.
 *
 * A count of zero is silent: an older log can carry a Warlord played with every
 * knight already awake (now refused as ErrCardNoEffect), and the cue means "a
 * knight woke up". `null` is a log predating the count field and does sound.
 * One hit, not one per knight, since it is a single act.
 */
export function warlordSound(count: number | null): EventSound | null {
  if (count === 0) return null;
  return { slot: "sound_knight_ready", semitones: 0 };
}

/**
 * Pure: whether a `cak_knight_promoted` is the tail of a Smith play and should
 * stay silent. Smith promotes up to two knights with one event each, which
 * sounded like a stutter.
 *
 * Every free promotion comes from Smith (a paid promotion is one command for
 * one knight; the Deserter's free piece is a build), so a free promotion right
 * behind another by the same player is the same card. Paid promotions are
 * never collapsed.
 */
type SoundEvent = { type: string; data?: unknown };

export function isRepeatPromotion(prev: SoundEvent | undefined, cur: SoundEvent): boolean {
  if (cur.type !== "cak_knight_promoted" || prev?.type !== "cak_knight_promoted") return false;
  const a = prev.data as { player?: number; free?: boolean } | undefined;
  const b = cur.data as { player?: number; free?: boolean } | undefined;
  return !!a?.free && !!b?.free && a.player === b.player;
}

/**
 * Buying a city improvement, pitched and levelled by the level reached.
 * `cak_improved` carries neither track nor level in its type, so this is not in
 * `eventSound`.
 *
 * All three tracks sound the same; the cue conveys the size of the buy. Each
 * level is 5% louder and `IMPROVE_STEP_SEMITONES` higher than the one below,
 * level 1 being the sample as authored and level 5 (metropolis) the top. The
 * whole climb is +1.6 semitones and about +22% gain, within the range the
 * placement offsets use, so it reads as one series.
 */
const IMPROVE_STEP_SEMITONES = 0.4;
const IMPROVE_STEP_GAIN = 1.05;
const IMPROVE_MAX_LEVEL = 5;

/**
 * Pure: the cue for `cak_improved` at `level`, the track level reached (1-5).
 * Out-of-range levels clamp, so an unreadable payload plays the bottom rung.
 */
export function improveSound(level: number): EventSound {
  const rung = Math.min(IMPROVE_MAX_LEVEL, Math.max(1, Math.round(level || 1))) - 1;
  return {
    slot: "sound_upgrade",
    semitones: rung * IMPROVE_STEP_SEMITONES,
    gain: Math.pow(IMPROVE_STEP_GAIN, rung),
  };
}

/**
 * Per-clip gain. The pack has no mix of its own; every slot plays at full gain
 * unless listed here.
 *
 * `sound_place` is the most repeated hit after the dice and sat on top of the
 * mix at full gain. `sound_start` is hot and the first thing heard after
 * unmuting. `sound_upgrade` and `sound_knight_ready` are frequent (upwards of
 * sixty upgrades in a four-player game) and change nothing on the board, so
 * they sit low; `improveSound`'s per-level boost rides on top.
 *
 * Slot URLs come straight from `assetURL`, a pure function of the manifest.
 */
const CLIP_VOLUME = 1;
const SLOT_VOLUME: Record<string, number> = {
  sound_place: 0.8,
  sound_start: 0.8,
  sound_upgrade: 0.35,
  sound_knight_ready: 0.35,
};

/** Pure: the per-clip gain for a slot, defaulting to the unmixed full level. */
export function slotVolume(slot: string): number {
  return SLOT_VOLUME[slot] ?? CLIP_VOLUME;
}

/** Pure: effective gain for a clip given master + per-asset tweak volume. */
export function effectiveVolume(masterV: number, tweakV: number): number {
  return Math.min(1, Math.max(0, masterV * tweakV));
}

/** Pure: playback rate for a pitch offset in cents. 1200 cents = one octave. */
export function rateForCents(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/**
 * Pure: when a hit should start, given the requested time and the last start
 * for the same slot. Two identical samples in one tick (road building places
 * two roads) would sum into one phase-cancelling thump; nudging the second
 * gives an audible "tk-tk".
 */
export const MIN_GAP = 0.06; // seconds between two hits of the same slot

/** How far past its requested time a hit may be pushed before it is dropped. */
export const MAX_SPREAD = 0.25;

/**
 * Returns null when the hit is surplus and should be dropped. Spacing alone is
 * unbounded (fifty hits schedule a three-second ladder); the cap keeps at most
 * five of a slot.
 */
export function startTime(requested: number, lastStart: number | undefined): number | null {
  const at = lastStart === undefined ? requested : Math.max(requested, lastStart + MIN_GAP);
  return at - requested > MAX_SPREAD ? null : at;
}

/**
 * Pure: when a hit that waits for the opening cue may start. A floor in the
 * past is no delay, so it self-expires.
 */
export function startAfterCue(requested: number, cueEndsAt: number): number {
  return Math.max(requested, cueEndsAt);
}

/** Rolling window over all slots, so several different sounds cannot stack either. */
export const BURST_WINDOW = 0.25;
export const MAX_BURST = 4;
export type Burst = { start: number; count: number };

/**
 * Pure: whether a hit is admitted, and the window state that follows it.
 * Per-slot spacing cannot see across slots, and one Knights command can emit a
 * dozen events; this caps the worst case at four hits in a quarter second.
 */
export function admitBurst(now: number, b: Burst): { ok: boolean; next: Burst } {
  const next = now - b.start > BURST_WINDOW ? { start: now, count: 0 } : b;
  if (next.count >= MAX_BURST) return { ok: false, next };
  return { ok: true, next: { start: next.start, count: next.count + 1 } };
}

/**
 * Pure: may a sound be played right now?
 *
 * `muted` is the player's choice, `held` is the entry screen (see
 * `setAudioHeld`), and the context state is the browser's. A suspended
 * context's clock does not advance, so hits scheduled against it all fire
 * together on resume (a tab backgrounded for two minutes played sixty at once).
 *
 * Page visibility is not checked: a backgrounded tab is still a seat, and the
 * turn cue is why players leave it open. While the browser keeps the clock
 * running we play; when it stops, hits are dropped.
 */
export function shouldPlay(muted: boolean, held: boolean, state: AudioContextState): boolean {
  return !muted && !held && state === "running";
}

// --- WebAudio sound effects -------------------------------------------------

type PlayOpts = {
  /** Fixed pitch offset in semitones (the per-piece variation). */
  semitones?: number;
  /** Random pitch offset, ± this many cents, drawn per hit (the dice). */
  jitterCents?: number;
  /** Delay before the hit, in seconds. */
  delay?: number;
  /**
   * Per-hit gain multiplier on top of the slot's mix level (the improvement
   * ladder). Defaults to 1; the product is still clamped to the master ceiling.
   */
  gain?: number;
  /**
   * Wait for the opening cue to finish before sounding. The first player's
   * turn starts with the game, and its cue landed on top of the start cue.
   * Self-expires once the cue is over.
   */
  afterCue?: boolean;
};

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>(); // decoded, by URL
const loading = new Map<string, Promise<AudioBuffer | null>>();
const lastStart = new Map<string, number>(); // slot -> ctx time of last hit
let burst: Burst = { start: 0, count: 0 };
/** Context time the opening cue finishes; 0 once it has, or if it never played. */
let cueEndsAt = 0;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    armLifecycle(ctx);
  }
  return ctx;
}

/**
 * Keep the clock running across a tab switch. Backgrounded play is wanted (see
 * shouldPlay), so this asks for a resume on hide as well as on show; browsers
 * may still refuse or re-suspend a hidden tab. On return it also clears stale
 * pacing state and nudges the music element.
 */
function armLifecycle(c: AudioContext) {
  if (typeof document === "undefined") return;
  document.addEventListener("visibilitychange", () => {
    // Not while the entry screen is up: the context is suspended on purpose.
    if (c.state === "suspended" && !held) void c.resume().catch(() => {});
    if (document.hidden) return;
    resetPacing();
    refreshMusic();
  });
  c.addEventListener("statechange", () => {
    if (c.state === "running") resetPacing();
  });
}

function load(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = loading.get(url);
  if (cached) return cached;
  const job = fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((bytes) => c.decodeAudioData(bytes))
    .then((buf) => {
      buffers.set(url, buf);
      return buf;
    })
    .catch(() => {
      // A missing or undecodable clip leaves the slot silent. Drop the memo so
      // a later pack swap can retry.
      loading.delete(url);
      return null;
    });
  loading.set(url, job);
  return job;
}

/** The opening cue. Named because other hits wait behind it (see `afterCue`). */
export const START_SLOT = "sound_start";

/**
 * Five recorded dice takes. Dice is the most repeated sound, and one take is
 * recognisable however it is jittered, because pitch-shifting keeps the
 * envelope.
 */
export const DICE_SLOTS = [
  "sound_dice-0",
  "sound_dice-1",
  "sound_dice-2",
  "sound_dice-3",
  "sound_dice-4",
] as const;

/** A take at random. Callers ask per roll, so consecutive rolls differ. */
export function diceSlot(): string {
  return DICE_SLOTS[Math.floor(Math.random() * DICE_SLOTS.length)];
}

/**
 * The effect slots a game plays, warmed as a set in the lobby and again on
 * entering the game. Music is not here: it streams from an <audio> element and
 * is off by default.
 */
export const GAME_SOUND_SLOTS = [
  "sound_start",
  "sound_turn",
  "sound_place",
  ...DICE_SLOTS,
  "sound_knight_ready",
  "sound_upgrade",
  "sound_seven",
  "sound_barbarians",
];

/**
 * Decode the given slots up front so the first hit of a game is not late. Safe
 * to call repeatedly.
 */
export function preload(slots: string[]) {
  // This constructs the AudioContext before any gesture, so its clock sits at
  // zero until the first click. Decoding into a suspended context is fine;
  // `play`'s gate handles the frozen clock.
  const c = audioCtx();
  if (!c) return;
  for (const slot of slots) {
    const url = assetURL(slot);
    if (url && !buffers.has(url)) void load(c, url);
  }
}

function fire(c: AudioContext, buf: AudioBuffer, slot: string, o: PlayOpts) {
  // Admit before building any node, so a dropped hit allocates nothing and does
  // not advance `lastStart`.
  const wanted = c.currentTime + (o.delay ?? 0);
  const requested = o.afterCue ? startAfterCue(wanted, cueEndsAt) : wanted;
  const at = startTime(requested, lastStart.get(slot));
  if (at === null) return;
  const admission = admitBurst(c.currentTime, burst);
  burst = admission.next;
  if (!admission.ok) return;

  const cents =
    (o.semitones ?? 0) * 100 + (o.jitterCents ? (Math.random() * 2 - 1) * o.jitterCents : 0);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rateForCents(cents);
  const gain = c.createGain();
  gain.gain.value = effectiveVolume(master, slotVolume(slot) * (o.gain ?? 1));
  src.connect(gain).connect(c.destination);
  lastStart.set(slot, at);
  // Record when the cue ends, for `afterCue` hits. Playback rate changes the
  // length.
  if (slot === START_SLOT) cueEndsAt = at + buf.duration / (src.playbackRate.value || 1);
  src.start(at);
}

/** Forget the spacing and burst state; their times refer to a clock that moved. */
function resetPacing() {
  lastStart.clear();
  burst = { start: 0, count: 0 };
  // The floor is a timestamp on a clock that just jumped.
  cueEndsAt = 0;
}

export function play(slot: string, opts: PlayOpts = {}) {
  // Held drops rather than defers: see setAudioHeld.
  if (muted || held) return;
  // No visibility check: a hidden tab still gets its turn cue (see
  // shouldPlay). The only gate is the context clock, below.
  const url = assetURL(slot);
  if (!url) return;
  const c = audioCtx();
  if (!c) return;
  if (c.state !== "running") {
    // A hold is lifting and the resume is in flight: wait for it rather than
    // drop (see `resuming`). Re-entering `play` re-checks the gate and the
    // decode path. It cannot loop: `resuming` is cleared before these
    // callbacks run, so a failed resume falls through to the drop below.
    if (resuming) {
      void resuming.then(() => play(slot, opts));
      return;
    }
    // The autoplay policy has not been lifted, or the browser suspended us.
    // Ask for a resume and arm the gesture path so the next event is audible,
    // but drop this one: scheduling against a stopped clock makes the hits
    // fire together on resume.
    void c.resume().catch(() => {});
    armUnlock();
    return;
  }
  const buf = buffers.get(url);
  if (buf) {
    fire(c, buf, slot, opts);
    return;
  }
  // Not decoded yet (preload missed, or the pack changed): fire when it lands.
  // Re-check the whole gate, since the player may have muted or the context
  // stopped during the decode.
  void load(c, url).then((b) => {
    if (b && shouldPlay(muted, held, c.state)) fire(c, b, slot, opts);
  });
}

// --- Background music: one looping element, gated by an enable flag and the
// presence of a resolvable sound_music URL (only set while in a game). ---
const MUSIC_SLOT = "sound_music";
let musicEnabled = false;
let musicEl: HTMLAudioElement | null = null;
let unlockArmed = false;

export function isMusicEnabled() {
  return musicEnabled;
}
export function setMusicEnabled(on: boolean) {
  musicEnabled = on;
  refreshMusic();
}

function refreshMusicVolume() {
  if (!musicEl) return;
  musicEl.volume = effectiveVolume(master, slotVolume(MUSIC_SLOT));
}

export function refreshMusic() {
  // The music element is not on the context, so suspending the context does
  // not silence it: the hold is read here too, and release calls back in.
  const url = musicEnabled && !held ? assetURL(MUSIC_SLOT) : null;
  if (!url) {
    stopMusic();
    return;
  }
  if (typeof document === "undefined") return;
  if (!musicEl) {
    musicEl = new Audio();
  }
  musicEl.loop = true;
  if (musicEl.src !== url) musicEl.src = url;
  musicEl.volume = effectiveVolume(master, slotVolume(MUSIC_SLOT));
  if (musicEl.paused) void musicEl.play().catch(() => armUnlock());
}

export function stopMusic() {
  if (musicEl) musicEl.pause();
}

// Browsers block audio until a user gesture; retry the music start and resume
// the effects context once on the first pointer/key event, then disarm.
function armUnlock() {
  if (unlockArmed || typeof document === "undefined") return;
  unlockArmed = true;
  const retry = () => {
    document.removeEventListener("pointerdown", retry);
    document.removeEventListener("keydown", retry);
    unlockArmed = false;
    resetPacing();
    // Do not start over the loading screen; the release does its own resume,
    // and leaving the unlock disarmed lets the next dropped hit re-arm it.
    if (ctx?.state === "suspended" && !held) void ctx.resume().catch(() => {});
    refreshMusic();
  };
  document.addEventListener("pointerdown", retry, { once: true });
  document.addEventListener("keydown", retry, { once: true });
}
