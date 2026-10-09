import { test, expect, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SLOTS, assetURL } from "./assets";
import { TRACK_ROW } from "./improvements";
import {
  DICE_SLOTS,
  diceSlot,
  GAME_SOUND_SLOTS,
  eventSound,
  improveSound,
  isRepeatPromotion,
  warlordSound,
  setMuted,
  isMuted,
  effectiveVolume,
  slotVolume,
  rateForCents,
  startTime,
  startAfterCue,
  admitBurst,
  shouldPlay,
  MIN_GAP,
  MAX_SPREAD,
  BURST_WINDOW,
  MAX_BURST,
  setMusicEnabled,
  isMusicEnabled,
  setVolume,
  preload,
  setAudioHeld,
  isAudioHeld,
} from "./sound";

test("eventSound maps placements to the shared sample", () => {
  expect(eventSound("settlement_built")).toEqual({ slot: "sound_place", semitones: 0 });
  expect(eventSound("city_built")).toEqual({ slot: "sound_place", semitones: 2 });
  // Roads and ships are the same act, so they share an offset.
  expect(eventSound("road_built")).toEqual(eventSound("ship_built"));
  // Setup variants sound like their in-game counterparts.
  expect(eventSound("settlement_placed")).toEqual(eventSound("settlement_built"));
  expect(eventSound("setup_city_placed")).toEqual(eventSound("city_built"));
  // Medicine upgrades a settlement to a city at a discount under its own event
  // type (cak_cheap_city); the board change is the same.
  expect(eventSound("cak_cheap_city")).toEqual(eventSound("city_built"));
});

test("eventSound leaves payload-dependent cues to the caller", () => {
  // dice_rolled needs its payload (a seven?), cak_improved the level reached,
  // and the start cue is decided from the arrival log.
  expect(eventSound("dice_rolled")).toBeNull();
  expect(eventSound("cak_improved")).toBeNull();
  expect(eventSound("board_generated")).toBeNull();
});

test("improveSound rises in pitch and gain with the level", () => {
  // Level 1 is the sample as authored: no offset, no boost.
  expect(improveSound(1)).toEqual({ slot: "sound_upgrade", semitones: 0, gain: 1 });
  // Every rung is strictly above the one below on both axes.
  for (const lv of [2, 3, 4, 5]) {
    expect(improveSound(lv).semitones).toBeGreaterThan(improveSound(lv - 1).semitones);
    expect(improveSound(lv).gain!).toBeGreaterThan(improveSound(lv - 1).gain!);
    // 5% per upgrade, compounding.
    expect(improveSound(lv).gain!).toBeCloseTo(improveSound(lv - 1).gain! * 1.05, 10);
  }
  // The whole climb stays subtle: under two semitones and a quarter louder.
  expect(improveSound(5).semitones).toBeLessThan(2);
  expect(improveSound(5).gain!).toBeLessThan(1.25);
  // The ladder stops at 5, where the track stops.
  expect(improveSound(6)).toEqual(improveSound(5));
  // One sample at one pitch whatever the track; nothing here takes a track.
  expect(TRACK_ROW.length).toBe(3);
  // A level that should never arrive still returns something playable.
  expect(improveSound(0)).toEqual(improveSound(1));
  expect(improveSound(-3)).toEqual(improveSound(1));
  expect(improveSound(NaN)).toEqual(improveSound(1));
});

test("eventSound is silent for unmapped events", () => {
  for (const ev of [
    "dev_card_bought",
    "knight_played",
    "trade_executed",
    "card_stolen",
    "unknown_event",
  ]) {
    expect(eventSound(ev), ev).toBeNull();
  }
  // dice_rolled is handled by the caller (it needs the payload to spot a seven).
  expect(eventSound("dice_rolled")).toBeNull();
});

test("mute gate toggles", () => {
  setMuted(true);
  expect(isMuted()).toBe(true);
  setMuted(false);
  expect(isMuted()).toBe(false);
});

test("effectiveVolume multiplies master by tweak, clamped 0..1", () => {
  expect(effectiveVolume(0.8, 1)).toBeCloseTo(0.8);
  expect(effectiveVolume(0.5, 0.5)).toBeCloseTo(0.25);
  expect(effectiveVolume(2, 2)).toBe(1);
  expect(effectiveVolume(-1, 1)).toBe(0);
});

test("slotVolume seats the mixed slots and leaves every other slot alone", () => {
  // The placement sample fires several times a turn and the start cue is a
  // hot sample; both sit a notch under the unmixed slots.
  for (const slot of ["sound_place", "sound_start"]) {
    expect(slotVolume(slot), slot).toBeCloseTo(0.8);
  }
  // The two cues that change nothing on the board sit well under everything
  // else, whoever caused them.
  for (const slot of ["sound_upgrade", "sound_knight_ready"]) {
    expect(slotVolume(slot), slot).toBeCloseTo(0.35);
  }
  const mixed = ["sound_place", "sound_start", "sound_upgrade", "sound_knight_ready"];
  for (const slot of GAME_SOUND_SLOTS.filter((s) => !mixed.includes(s))) {
    expect(slotVolume(slot), slot).toBe(1);
  }
  expect(slotVolume("sound_music")).toBe(1);
  // The master slider still scales them.
  expect(effectiveVolume(0.5, slotVolume("sound_place"))).toBeCloseTo(0.4);
});

test("rateForCents is 1 at zero and doubles an octave up", () => {
  expect(rateForCents(0)).toBe(1);
  expect(rateForCents(1200)).toBeCloseTo(2);
  expect(rateForCents(-1200)).toBeCloseTo(0.5);
  // A two-semitone city sits just above the settlement.
  expect(rateForCents(200)).toBeCloseTo(1.1225, 4);
});

test("startTime nudges a repeat of the same slot past the minimum gap", () => {
  // First hit of a slot plays exactly when asked.
  expect(startTime(10, undefined)).toBe(10);
  // A second hit in the same tick is pushed out rather than doubling up.
  expect(startTime(10, 10)).toBeCloseTo(10 + MIN_GAP);
  // A hit that is already late enough is left alone.
  expect(startTime(10 + MIN_GAP * 2, 10)).toBeCloseTo(10 + MIN_GAP * 2);
});

test("startTime drops a hit rather than queueing it past the spread cap", () => {
  // Spacing alone is unbounded: fifty hits of one slot would schedule a
  // three-second ladder. Five, then silence.
  let last: number | undefined;
  const admitted: number[] = [];
  for (let i = 0; i < 50; i++) {
    const at = startTime(10, last);
    if (at === null) break;
    admitted.push(+(at - 10).toFixed(4));
    last = at;
  }
  expect(admitted).toEqual([0, 0.06, 0.12, 0.18, 0.24]);
  expect(startTime(10, 10 + MAX_SPREAD)).toBeNull();
  // A hit whose own requested time has moved on is never a leftover.
  expect(startTime(20, 10)).toBe(20);
});

test("admitBurst caps what several different slots can stack into", () => {
  // Per-slot spacing cannot see across slots, and one Knights command emits a
  // dozen events. Four in a quarter second, then drop.
  let b = { start: 0, count: 0 };
  const ok: boolean[] = [];
  for (let i = 0; i < 6; i++) {
    const r = admitBurst(1, b);
    b = r.next;
    ok.push(r.ok);
  }
  expect(ok).toEqual([true, true, true, true, false, false]);
  // A later window starts fresh.
  const later = admitBurst(1 + BURST_WINDOW + 0.01, b);
  expect(later.ok).toBe(true);
  expect(later.next.count).toBe(1);
});

test("shouldPlay needs a running clock and no mute", () => {
  expect(shouldPlay(false, false, "running")).toBe(true);
  // A suspended context's clock does not advance, so anything scheduled
  // against it would fire together on resume.
  expect(shouldPlay(false, false, "suspended")).toBe(false);
  expect(shouldPlay(false, false, "closed")).toBe(false);
  expect(shouldPlay(true, false, "running")).toBe(false);
});

test("the entry hold silences a running clock", () => {
  // While the loading card is up the client is already a live seat; cues must
  // not play behind it.
  expect(shouldPlay(false, true, "running")).toBe(false);
  // The hold is not the player's mute: releasing it must not turn sound on for
  // someone who muted.
  expect(shouldPlay(true, false, "running")).toBe(false);
  expect(shouldPlay(true, true, "running")).toBe(false);
  expect(shouldPlay(false, false, "running")).toBe(true);
});

test("the hold is separate from mute and idempotent", () => {
  setMuted(false);
  expect(isAudioHeld()).toBe(false);
  setAudioHeld(true);
  expect(isAudioHeld()).toBe(true);
  // Idempotent: the game screen sets it from an effect that re-runs, and a
  // second hold must not need a second release.
  setAudioHeld(true);
  setAudioHeld(false);
  expect(isAudioHeld()).toBe(false);
  // The player's own switch is untouched throughout.
  expect(isMuted()).toBe(false);
  setAudioHeld(true);
  expect(isMuted()).toBe(false);
  setAudioHeld(false);
  setMuted(true);
});

test("music is not started while the entry screen is up", () => {
  // Music is an <audio> element outside the context, so `refreshMusic` reads
  // the hold itself. The player's setting survives the hold, and releasing
  // starts the music.
  setAudioHeld(true);
  setMusicEnabled(true);
  expect(isMusicEnabled()).toBe(true);
  setAudioHeld(false);
  expect(isMusicEnabled()).toBe(true);
  setMusicEnabled(false);
});

test("a hidden tab still plays", () => {
  // Visibility is not an input: while the browser keeps our clock running, a
  // hidden tab plays like a visible one (the turn cue is why it stays open).
  document.dispatchEvent(new Event("visibilitychange"));
  expect(shouldPlay(false, false, "running")).toBe(true);
});

test("a frozen clock admits nothing", () => {
  // A backgrounded tab's frozen currentTime: with the gate, none of these
  // hits are scheduled.
  const frozen = 37.9893;
  let admitted = 0;
  for (let i = 0; i < 60; i++) {
    if (shouldPlay(false, false, "suspended")) admitted++;
  }
  expect(admitted).toBe(0);
  // Once running again, the cap still limits the first burst.
  let b = { start: 0, count: 0 };
  let played = 0;
  for (let i = 0; i < 60; i++) {
    const r = admitBurst(frozen, b);
    b = r.next;
    if (r.ok) played++;
  }
  expect(played).toBe(MAX_BURST);
});

test("startAfterCue waits for the opening cue to end", () => {
  // The first player's turn begins as the game does, so the two cues would
  // land on top of each other.
  const cueEnds = 12.4;
  expect(startAfterCue(10.0, cueEnds)).toBe(cueEnds);
  // Exactly at the boundary is not a wait.
  expect(startAfterCue(cueEnds, cueEnds)).toBe(cueEnds);
  // Once the cue is past, the floor costs nothing, so later turns sound
  // immediately with no state to clear.
  expect(startAfterCue(30.0, cueEnds)).toBe(30.0);
  // No cue ever played: no wait.
  expect(startAfterCue(3.2, 0)).toBe(3.2);
});

test("waiting for the cue does not trip the spread cap", () => {
  // startTime measures the push from the requested time, and a deferred hit's
  // requested time is already the floor, so the wait is not mistaken for
  // queueing and dropped.
  const deferred = startAfterCue(10, 12.4);
  expect(startTime(deferred, undefined)).toBe(12.4);
  expect(startTime(deferred, 12.4)).toBeCloseTo(12.4 + MIN_GAP);
});

test("music enabled flag toggles without a resolver (no throw)", () => {
  setVolume(0.5);
  setMusicEnabled(true);
  expect(isMusicEnabled()).toBe(true);
  setMusicEnabled(false);
  expect(isMusicEnabled()).toBe(false);
  setVolume(0.8);
});

test("every dice take is a declared slot with a file on disk", () => {
  // A missing take fails silently: that roll makes no sound.
  const declared = new Set(SLOTS.map((slot) => slot.id));
  const assets = join(__dirname, "..", "..", "public", "assets");
  for (const slot of DICE_SLOTS) {
    expect(declared, `${slot} is not in SLOTS`).toContain(slot);
    expect(existsSync(join(assets, `${slot}.mp3`)), `${slot}.mp3 missing`).toBe(true);
  }
});

test("the dice takes are preloaded", () => {
  // Takes are picked at roll time, so an unwarmed take arrives late.
  for (const slot of DICE_SLOTS) expect(GAME_SOUND_SLOTS).toContain(slot);
});

test("picking a take reaches all of them and nothing else", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) seen.add(diceSlot());
  expect([...seen].sort()).toEqual([...DICE_SLOTS].sort());
});

test("readying a knight is the one non-placement event with a sound", () => {
  // Not a placement: nothing is built or moves, so it neither borrows the
  // placement thunk nor is pitched like a piece landing.
  expect(eventSound("cak_knight_activated")).toEqual({
    slot: "sound_knight_ready",
    semitones: 0,
  });
  // Built and promoted are placements; the rest are silent.
  expect(eventSound("cak_knight_built")?.slot).toBe("sound_place");
  expect(eventSound("cak_knight_promoted")?.slot).toBe("sound_place");
  expect(eventSound("cak_knight_moved")).toBeNull();
  expect(eventSound("cak_knights_refresh")).toBeNull();
});

test("warlordSound plays once, only when a knight woke", () => {
  // The card wakes every inactive knight in one event rather than one
  // `cak_knight_activated` each, so `eventSound` never sees it.
  expect(eventSound("cak_knights_all_active")).toBeNull();
  // Same cue as a knight readied singly; the count is not in the sound.
  expect(warlordSound(1)).toEqual({ slot: "sound_knight_ready", semitones: 0 });
  expect(warlordSound(4)).toEqual(warlordSound(1));
  // Every knight already awake: the board does not change, so no cue.
  expect(warlordSound(0)).toBeNull();
  // A log predating the count field. Unknown is not zero, so it sounds.
  expect(warlordSound(null)).toEqual({ slot: "sound_knight_ready", semitones: 0 });
});

test("isRepeatPromotion collapses a Smith's second promotion", () => {
  const smith = (player: number) => ({
    type: "cak_knight_promoted",
    data: { player, free: true },
  });
  const paid = (player: number) => ({
    type: "cak_knight_promoted",
    data: { player },
  });
  // The second free promotion behind the first, same player: the same card.
  expect(isRepeatPromotion(smith(1), smith(1))).toBe(true);
  // Nothing in front of it, so it is the card's first (and audible) promotion.
  expect(isRepeatPromotion(undefined, smith(1))).toBe(false);
  // Two players cannot be playing one Smith.
  expect(isRepeatPromotion(smith(0), smith(1))).toBe(false);
  // Paid promotions are one command each, however close together; collapsing
  // them would silence a real second act.
  expect(isRepeatPromotion(paid(1), paid(1))).toBe(false);
  expect(isRepeatPromotion(smith(1), paid(1))).toBe(false);
  // Anything between the two breaks the run.
  expect(isRepeatPromotion({ type: "cak_knight_built", data: { player: 1 } }, smith(1))).toBe(
    false,
  );
  expect(
    isRepeatPromotion(smith(1), { type: "cak_knight_built", data: { player: 1, free: true } }),
  ).toBe(false);
  // The promotion itself still has its cue; only the echo is dropped.
  expect(eventSound("cak_knight_promoted")).toEqual({ slot: "sound_place", semitones: 5 });
});

test("the knight cue is declared, preloaded and on disk", () => {
  const declared = new Set(SLOTS.map((slot) => slot.id));
  expect(declared).toContain("sound_knight_ready");
  expect(GAME_SOUND_SLOTS).toContain("sound_knight_ready");
  expect(
    existsSync(join(__dirname, "..", "..", "public", "assets", "sound_knight_ready.mp3")),
  ).toBe(true);
});

test("the barbarian cue is declared, preloaded and on disk", () => {
  const declared = new Set(SLOTS.map((slot) => slot.id));
  expect(declared).toContain("sound_barbarians");
  expect(GAME_SOUND_SLOTS).toContain("sound_barbarians");
  expect(existsSync(join(__dirname, "..", "..", "public", "assets", "sound_barbarians.mp3"))).toBe(
    true,
  );
});

test("the barbarian cue is not mapped by event type", () => {
  // The skipped first attack emits the same event type and must stay silent,
  // so only the caller (which sees `skipped` in the payload) can sound it.
  expect(eventSound("cak_barbarian_attack")).toBeNull();
});

test("moving a marker plays the placement sample lower", () => {
  // Not a placement: an existing piece moved. Same sample so it reads as the
  // board responding, pitched down so it does not read as a purchase.
  for (const ev of ["robber_moved", "pirate_moved", "cak_merchant_placed"]) {
    const sound = eventSound(ev);
    expect(sound?.slot, ev).toBe("sound_place");
    // The interval is defined by its rate, so check the rate.
    expect(rateForCents((sound?.semitones ?? 0) * 100), ev).toBeCloseTo(0.9, 6);
  }
  // Relative to the settlement, which is at the sample's own pitch. Not below
  // everything: a wall is lower still.
  expect(eventSound("settlement_built")!.semitones).toBe(0);
  expect(eventSound("robber_moved")!.semitones).toBeLessThan(0);
});

// Asset resolution.
//
// Losing a URL or a file from the pack silences every cue with no visible
// change. Both halves are needed: a slot can resolve to a missing URL, and a
// file can exist under a name nothing asks for.

test("every game sound slot resolves to a committed file", () => {
  const pub = join(__dirname, "..", "..", "public");
  for (const slot of GAME_SOUND_SLOTS) {
    const url = assetURL(slot);
    expect(url, `${slot} resolves to no URL`).toBeTruthy();
    expect(existsSync(join(pub, url!)), `${url} missing`).toBe(true);
  }
});

test("preload fetches a buffer for every game sound slot", () => {
  // End to end through the module the game calls: slot -> URL -> fetch. A
  // resolver answering null fetches nothing, so every cue
  // would be silent.
  const fetched: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((u: string) => {
      fetched.push(String(u));
      return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }),
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      currentTime = 0;
      addEventListener() {}
      decodeAudioData() {
        return Promise.resolve({} as AudioBuffer);
      }
    },
  );
  try {
    preload(GAME_SOUND_SLOTS);
    expect(new Set(fetched)).toEqual(new Set(GAME_SOUND_SLOTS.map((s) => assetURL(s))));
  } finally {
    vi.unstubAllGlobals();
  }
});
