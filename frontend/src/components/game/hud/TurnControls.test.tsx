import { test, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DiceRow, EndTurnPill, TurnControls } from "./TurnControls";
import { DOCK_TRIGGER_H, SQUAT_TURN_H, SQUAT_TURN_ROW } from "@/lib/hudChrome";

// jsdom has no layout, so this tests what the components draw and the
// arithmetic they write into their style attributes.

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

const rollBtn = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('button[aria-label="Roll the dice"]');
const endBtn = (el: HTMLElement) =>
  el.querySelector<HTMLButtonElement>('button[aria-label="End turn"]');

test("corner dice act as the roll button", () => {
  const onRoll = vi.fn();
  const { el } = render(
    <TurnControls
      wide={false}
      dice={<span>DICE</span>}
      canRoll
      onRoll={onRoll}
      canEnd={false}
      onEnd={() => {}}
    />,
  );
  expect(rollBtn(el)!.textContent).toBe("DICE");
  act(() => rollBtn(el)!.click());
  expect(onRoll).toHaveBeenCalledTimes(1);
});

test("the dice row rolls only when allowed", () => {
  // The same control, one line of the dock stack. A button only while there is
  // a roll to make; otherwise a readout.
  const onRoll = vi.fn();
  const { el } = render(<DiceRow dice={<span>DICE</span>} canRoll onRoll={onRoll} />);
  act(() => rollBtn(el)!.click());
  expect(onRoll).toHaveBeenCalledTimes(1);

  const { el: idle } = render(<DiceRow dice={<span>DICE</span>} canRoll={false} onRoll={onRoll} />);
  expect(rollBtn(idle)).toBeNull();
  expect(idle.textContent).toContain("DICE");
});

test("dice row height is stable while wobbling", () => {
  // The dice don't grow when rollable (that would shove the dock down); the tap
  // target grows into the gaps instead.
  const line = (el: HTMLElement) => el.firstElementChild as HTMLElement;
  const { el: idle } = render(
    <DiceRow dice={<span>DICE</span>} canRoll={false} onRoll={() => {}} />,
  );
  const { el: live } = render(<DiceRow dice={<span>DICE</span>} canRoll onRoll={() => {}} />);
  expect(line(idle).style.height).toBe(`${DOCK_TRIGGER_H}px`);
  expect(line(live).style.height).toBe(line(idle).style.height);
});

test("End turn on the trigger row is disabled until allowed", () => {
  // It sits in a line with the bank's five counts and two icon buttons, so it
  // just says "End".
  const onEnd = vi.fn();
  const { el } = render(<EndTurnPill canEnd onEnd={onEnd} />);
  expect(endBtn(el)!.textContent).toBe("End");
  act(() => endBtn(el)!.click());
  expect(onEnd).toHaveBeenCalledTimes(1);

  const { el: waiting } = render(<EndTurnPill canEnd={false} onEnd={onEnd} />);
  expect(endBtn(waiting)!.disabled).toBe(true);
  act(() => endBtn(waiting)!.click());
  expect(onEnd).toHaveBeenCalledTimes(1);
});

test("the trigger-row pill says Roll, and rolls, while the roll is yours", () => {
  // A phone has no corner cluster, so its pill carries the green prompt for
  // the first action too, in the same box.
  const onRoll = vi.fn();
  const onEnd = vi.fn();
  const { el } = render(<EndTurnPill canEnd={false} onEnd={onEnd} canRoll onRoll={onRoll} />);
  const pill = rollBtn(el)!;
  expect(pill.textContent).toBe("Roll");
  expect(pill.disabled).toBe(false);
  expect(pill.classList.contains("hud-primary")).toBe(true);
  act(() => pill.click());
  expect(onRoll).toHaveBeenCalledTimes(1);
  expect(onEnd).not.toHaveBeenCalled();
});

test("End turn is quiet on another seat's turn, in both layouts", () => {
  // The amber primary is lit only when pressing it does something; while
  // waiting, the button takes the secondary glass face.
  const waiting = (b: HTMLButtonElement) => {
    expect(b.getAttribute("data-waiting")).toBe("true");
    expect(b.classList.contains("hud-secondary")).toBe(true);
    expect(b.classList.contains("hud-primary")).toBe(false);
  };
  const cluster = (canEnd: boolean) =>
    render(
      <TurnControls
        wide
        dice={<span>DICE</span>}
        canRoll={false}
        onRoll={() => {}}
        canEnd={canEnd}
        onEnd={() => {}}
      />,
    ).el.querySelector<HTMLButtonElement>("button")!;

  waiting(cluster(false));
  waiting(endBtn(render(<EndTurnPill canEnd={false} onEnd={() => {}} />).el)!);

  // And it lights up once the turn is yours.
  expect(cluster(true).classList.contains("hud-primary")).toBe(true);
  expect(cluster(true).getAttribute("data-waiting")).toBeNull();
});

// Sideways on a phone the dock is a column and the turn controls are its foot:
// dice and End turn on one line, each a thumb's height. jsdom has no layout, so
// this pins the heights.
test("landscape phone: dice and End turn share one row", () => {
  const { el } = render(
    <TurnControls
      wide
      row
      dice={<span>DICE</span>}
      canRoll
      onRoll={() => {}}
      canEnd
      onEnd={() => {}}
    />,
  );
  const end = endBtn(el)!;
  expect(end.style.height).toBe(`${SQUAT_TURN_H}px`);
  expect(rollBtn(el)!.style.height).toBe(`${SQUAT_TURN_H}px`);
  expect(SQUAT_TURN_H).toBeGreaterThanOrEqual(40);
  // One line: the row container is a wrapping flex row, not the stacked column.
  expect(end.parentElement!.className).toContain("flex-wrap");
  expect(end.parentElement!.className).not.toContain("flex-col");
  // The classes spell the budget SQUAT_TURN_ROW adds up (lib/hudChrome), so the
  // arithmetic that says one line fits matches the row as drawn.
  const row = end.parentElement!.className.split(/\s+/);
  const px = (n: number) => `${n / 4}`.replace(/^0\./, "0.");
  expect(row).toContain(`px-${px(SQUAT_TURN_ROW.padX)}`);
  expect(row).toContain(`gap-${px(SQUAT_TURN_ROW.gap)}`);
  expect(end.className.split(/\s+/)).toContain(`min-w-[${SQUAT_TURN_ROW.endMinW}px]`);
  expect(rollBtn(el)!.className.split(/\s+/)).toContain(`px-${px(SQUAT_TURN_ROW.dicePadX)}`);
});
