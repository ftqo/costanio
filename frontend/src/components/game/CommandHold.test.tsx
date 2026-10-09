import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommandHoldContext, HeldActions } from "./CommandHold";
import { Overlay } from "./Overlay";
import { DiceRow, EndTurnPill } from "./hud/TurnControls";
import { TurnBanner } from "./hud/TurnBanner";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// While the board loads behind its entry cover, the game's own controls are
// shown but disabled, and everything else on the HUD (menus, chat, settings,
// Leave) keeps working. Rendered, because the claim is about what a press and
// a key do, not about which props were passed.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
}

const byLabel = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

/**
 * A cut-down game screen: the turn controls inside the hold, and the
 * chrome that must stay live (the account menu and chat) outside it, as
 * routes/Game arranges them.
 */
function Screen({
  held,
  onEnd,
  onRoll,
  onMenu,
  onChat,
}: {
  held: boolean;
  onEnd: () => void;
  onRoll: () => void;
  onMenu: () => void;
  onChat: (text: string) => void;
}) {
  return (
    <CommandHoldContext value={held}>
      <button type="button" aria-label="Account" onClick={onMenu}>
        me
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onChat((e.currentTarget.elements.namedItem("msg") as HTMLInputElement).value);
        }}
      >
        <input name="msg" aria-label="Chat" defaultValue="" />
        <button type="submit" aria-label="Send">
          send
        </button>
      </form>
      <HeldActions>
        <EndTurnPill canEnd onEnd={onEnd} />
        <DiceRow dice={<span>dice</span>} canRoll onRoll={onRoll} />
      </HeldActions>
    </CommandHoldContext>
  );
}

function setup(held: boolean) {
  const fns = { onEnd: vi.fn(), onRoll: vi.fn(), onMenu: vi.fn(), onChat: vi.fn() };
  render(<Screen held={held} {...fns} />);
  return fns;
}

describe("held game controls", () => {
  it("are disabled while the board loads and enabled once it is ready", () => {
    const fns = setup(true);
    const end = byLabel("End turn");
    expect(end).not.toBeNull();
    // Visible, and disabled through the fieldset: `:disabled` is what the
    // HUD's disabled faces key on.
    expect(end.matches(":disabled")).toBe(true);
    end.click();
    expect(fns.onEnd).not.toHaveBeenCalled();

    render(<Screen held={false} {...fns} />);
    expect(byLabel("End turn").matches(":disabled")).toBe(false);
    byLabel("End turn").click();
    expect(fns.onEnd).toHaveBeenCalledTimes(1);
  });

  it("leave the account menu and chat usable", () => {
    const fns = setup(true);
    const menu = byLabel("Account");
    expect(menu.matches(":disabled")).toBe(false);
    menu.click();
    expect(fns.onMenu).toHaveBeenCalledTimes(1);

    const input = host.querySelector<HTMLInputElement>('input[aria-label="Chat"]')!;
    expect(input.matches(":disabled")).toBe(false);
    input.focus();
    expect(document.activeElement).toBe(input);
    input.value = "gl hf";
    byLabel("Send").click();
    expect(fns.onChat).toHaveBeenCalledWith("gl hf");
  });

  it("do not answer the keyboard before the board is ready", () => {
    const fns = setup(true);
    // A key reaches a button only through focus: Tab, then Enter or Space,
    // which the browser turns into a click. A held control takes neither.
    const end = byLabel("End turn");
    end.focus();
    expect(document.activeElement).not.toBe(end);
    end.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    end.click();
    const dice = byLabel("Roll the dice");
    dice.focus();
    expect(document.activeElement).not.toBe(dice);
    dice.click();
    expect(fns.onEnd).not.toHaveBeenCalled();
    expect(fns.onRoll).not.toHaveBeenCalled();

    // The same keys work once the gate opens.
    render(<Screen held={false} {...fns} />);
    const live = byLabel("End turn");
    live.focus();
    expect(document.activeElement).toBe(live);
    live.click();
    expect(fns.onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("Overlay under the hold", () => {
  function dialog(held: boolean, onPick: () => void, onCancel: () => void) {
    render(
      <CommandHoldContext value={held}>
        <Overlay title="Steal from…" onCancel={onCancel} dismissLabel="Close">
          <button type="button" onClick={onPick}>
            Ada
          </button>
        </Overlay>
      </CommandHoldContext>,
    );
  }

  it("holds the decision but not the way out", () => {
    const onPick = vi.fn();
    const onCancel = vi.fn();
    dialog(true, onPick, onCancel);
    const pick = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ada")!;
    expect(pick.matches(":disabled")).toBe(true);
    pick.click();
    expect(onPick).not.toHaveBeenCalled();
    byLabel("Close").click();
    expect(onCancel).toHaveBeenCalledTimes(1);

    dialog(false, onPick, onCancel);
    const live = [...host.querySelectorAll("button")].find((b) => b.textContent === "Ada")!;
    expect(live.matches(":disabled")).toBe(false);
    live.click();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("is untouched outside a provider", () => {
    const onPick = vi.fn();
    render(
      <Overlay title="Reset to lobby?">
        <button type="button" onClick={onPick}>
          Reset
        </button>
      </Overlay>,
    );
    const b = [...host.querySelectorAll("button")].find((x) => x.textContent === "Reset")!;
    expect(b.matches(":disabled")).toBe(false);
    b.click();
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

describe("TurnBanner under the hold", () => {
  // Its chips (Move: robber or pirate; Place: road or ship) choose what the next
  // board tap does, so they wait with the rest; the banner itself is a readout.
  function banner(held: boolean, onPick: () => void) {
    render(
      <CommandHoldContext value={held}>
        <TurnBanner turnLabel="Your turn" mine>
          <button type="button" onClick={onPick}>
            Pirate
          </button>
        </TurnBanner>
      </CommandHoldContext>,
    );
    return [...host.querySelectorAll("button")].find((b) => b.textContent === "Pirate")!;
  }

  it("holds the mode choice until the board is ready", () => {
    const onPick = vi.fn();
    const held = banner(true, onPick);
    expect(held.matches(":disabled")).toBe(true);
    held.click();
    expect(onPick).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Your turn");

    banner(false, onPick).click();
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("draws no chip row when there are no chips", () => {
    render(
      <CommandHoldContext value>
        <TurnBanner turnLabel="Ada's turn">{false}</TurnBanner>
      </CommandHoldContext>,
    );
    expect(host.querySelector("fieldset")).toBeNull();
  });
});
