import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The game screen cannot be mounted in jsdom (WebGL board, websocket), so this
// pins the wiring at the source level, like the hooks guard.
//
// At desktop size a target prompt 96px down covers the board's top row, so
// the prompt hands its element to the game view, which folds its measured
// bottom edge into the board's top inset while it is up.
const src = readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");

it("every target prompt reports itself to the board's frame", () => {
  const prompt = src.slice(src.indexOf("function TargetPrompt("));
  expect(prompt.slice(0, prompt.indexOf("</div>"))).toContain("ref={registerPrompt}");
});

it("the board's top inset includes the prompt's band", () => {
  expect(src).toMatch(/top: Math\.max\(topFrac, promptFrac\)/);
  expect(src).toContain("promptSlot.set = setPromptEl");
});

// Reduced motion asks to be spared exactly this: 450 pieces for eight seconds.
it("the win confetti is withheld under reduced motion", () => {
  const at = src.indexOf("<Confetti");
  expect(src.slice(at - 400, at)).toContain("!noMotion");
});

// The prompt's one button (Cancel, Wagon, No thanks) must be a thumb's height
// on a phone either way up, with 12px text.
it("the target prompt's button is a phone-sized target", () => {
  const m = src.match(/const PROMPT_BUTTON = "([^"]+)"/);
  expect(m).not.toBeNull();
  const cls = m![1].split(" ");
  expect(cls).toContain("max-sm:min-h-10");
  expect(cls).toContain("squat:min-h-10");
  expect(cls.some((c) => /^text-\[(\d+)px\]$/.test(c) && Number(c.slice(6, -3)) < 12)).toBe(false);
  const prompt = src.slice(src.indexOf("function TargetPrompt("));
  expect(prompt.slice(0, prompt.indexOf("function YopPicker"))).toContain(
    "className={PROMPT_BUTTON}",
  );
});

// On a sideways phone the pill would cover the board's top row and the bank
// and log triggers, so it sits over the seat rail's column, placed by
// variables the root carries from the measured rail.
it("the target prompt stands over the seat rail on a sideways phone", () => {
  const prompt = src.slice(src.indexOf("function TargetPrompt("));
  expect(prompt.slice(0, prompt.indexOf("function YopPicker"))).toContain("SQUAT_PROMPT,");
  // The root carries the squat box inside `promptVars`, beside the portrait
  // prompt's own variable.
  expect(src).toMatch(/style=\{promptVars\}/);
  expect(src).toMatch(/\.\.\.squatPromptBox,/);
  expect(src).toMatch(/return squatPromptVars\(/);
});

// Below lg in portrait, a fixed 96px offset put the pill inside the seat strip,
// so it reads the strip's measured bottom from the root.
it("the target prompt stands under the measured seat strip on a phone", () => {
  const prompt = src.slice(src.indexOf("function TargetPrompt("));
  const body = prompt.slice(0, prompt.indexOf("function YopPicker"));
  expect(body).toContain("PROMPT_TOP,");
  expect(body).not.toMatch(/\btop-24\b/);
  expect(src).toMatch(/"--hud-prompt-top": `\$\{promptTop\}px`/);
  expect(src).toMatch(/promptTopPx\(\{/);
});

// On a sideways phone the dock is a column and its third row of tiles can run
// off the track, so the shelf asks its ScrollFade for vertical nudges there
// only.
it("the hand shelf's track grows up/down nudges on a sideways phone", () => {
  const at = src.indexOf(
    'wrapperClassName="flex-1 min-w-0 squat:flex squat:flex-col squat:min-h-0"',
  );
  expect(at).toBeGreaterThan(0);
  expect(src.slice(at, src.indexOf(">", src.indexOf("vArrows", at)))).toContain("vArrows={squat}");
});

// Every target prompt shares one slot at the top of the board. A voluntary
// step (fish spend, rider move, Crane) is local state that survives an
// arriving forced step, so its prompt must check that its mode is the one in
// force, not merely that it is armed; otherwise a Knight played with a fish
// road armed draws both pills in one place.
const promptConditions = (): string[] => {
  const re = /\n[ \t]*\{([^\n]*?)&&\s*\(?\s*(?:\/\/[^\n]*\n\s*)*<TargetPrompt/g;
  return [...src.matchAll(re)].map((m) => m[1].trim());
};

it("finds the gate of every target prompt", () => {
  expect(promptConditions()).toHaveLength((src.match(/<TargetPrompt\b/g) ?? []).length);
});

it("gates every target prompt on the effective mode or no forced step", () => {
  // Prompts that are not a board mode of the viewer's own turn, each with why.
  const exempt = [
    // Reminders for a forced panel the player stood down; they are the forced step.
    'camelRoleNow === "bid" && camelStood === "bid"',
    'camelRoleNow === "place" && camelStood === "place"',
    "raidersPanelOpen && raidersStood === raidersPanelOpen",
    "knightsDiscardProgress && myKnights?.progress && progressDiscardStood",
    // Owed by a seat that is not on turn; nothing of its own can be armed.
    "knState && knState.deserter_victim >= 0 && knState.deserter_victim === actorSeat",
    // `canAct` already excludes the robber, a discard and every module block.
    "canAct && owedFreeRoads > 0",
  ];
  const ungated = promptConditions().filter(
    (c) => !exempt.includes(c) && !/\beffMode\b|\bvoluntaryOpen\b/.test(c),
  );
  expect(ungated).toEqual([]);
});

it("the fish pickers wait for a forced step like the fish prompts do", () => {
  const gates = [...src.matchAll(/\{(fishPending === "[a-z_]+"[^\n]*?)&& \(/g)].map((m) => m[1]);
  expect(gates.length).toBeGreaterThanOrEqual(5);
  for (const g of gates) expect(g).toMatch(/\beffMode\b|\bvoluntaryOpen\b/);
});
