import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmProvider, useConfirm } from "./confirm";

// A harness whose button opens a confirm and reports the resolved value.
function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      data-testid="go"
      onClick={async () =>
        onResult(await confirm({ title: "Sure?", confirmText: "Yes", cancelText: "No" }))
      }
    >
      go
    </button>
  );
}

function mount(onResult: (v: boolean) => void) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() =>
    root.render(
      <ConfirmProvider>
        <Harness onResult={onResult} />
      </ConfirmProvider>,
    ),
  );
  return { container, root };
}

// Radix Dialog portals to document.body; find a button there by its label.
function clickBodyButton(label: string) {
  const btn = [...document.body.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!btn) throw new Error(`no button labelled "${label}"`);
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useConfirm", () => {
  it("resolves true when the confirm button is clicked", async () => {
    const onResult = vi.fn();
    const { container } = mount(onResult);
    act(() => {
      container
        .querySelector('[data-testid="go"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    clickBodyButton("Yes");
    await act(async () => {
      await Promise.resolve();
    });
    expect(onResult).toHaveBeenCalledWith(true);
  });

  it("resolves false when the cancel button is clicked", async () => {
    const onResult = vi.fn();
    const { container } = mount(onResult);
    act(() => {
      container
        .querySelector('[data-testid="go"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    clickBodyButton("No");
    await act(async () => {
      await Promise.resolve();
    });
    expect(onResult).toHaveBeenCalledWith(false);
  });
});

// suppressKey: a suppressed advisory resolves true without opening, and only
// confirming remembers the choice.
describe("confirm with suppressKey", () => {
  function SuppressHarness({ onResult }: { onResult: (v: boolean) => void }) {
    const confirm = useConfirm();
    return (
      <button
        data-testid="go"
        onClick={async () =>
          onResult(
            await confirm({
              title: "Sure?",
              confirmText: "Yes",
              cancelText: "No",
              suppressKey: "k",
            }),
          )
        }
      >
        go
      </button>
    );
  }
  function mountSuppress(onResult: (v: boolean) => void) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act(() =>
      root.render(
        <ConfirmProvider>
          <SuppressHarness onResult={onResult} />
        </ConfirmProvider>,
      ),
    );
    return { container, root };
  }
  function open(container: HTMLElement) {
    return act(async () => {
      container
        .querySelector("[data-testid=go]")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  function box() {
    return document.querySelector<HTMLInputElement>("[data-testid=confirm-dont-ask]");
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("offers the checkbox only when a suppressKey is given", async () => {
    const { container, root } = mountSuppress(() => {});
    await open(container);
    expect(box()).toBeTruthy();
    act(() => root.unmount());
  });

  it("skips the dialog after confirming with the box ticked", async () => {
    const seen: boolean[] = [];
    const { container, root } = mountSuppress((v) => seen.push(v));
    await open(container);
    await act(async () => box()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    clickBodyButton("Yes");
    await act(async () => {});
    expect(seen).toEqual([true]);

    await open(container);
    expect(box(), "dialog opened the second time").toBeFalsy();
    await act(async () => {});
    expect(seen, "resolved true without a dialog").toEqual([true, true]);
    act(() => root.unmount());
  });

  it("still asks after confirming unticked", async () => {
    const { container, root } = mountSuppress(() => {});
    await open(container);
    clickBodyButton("Yes");
    await act(async () => {});
    await open(container);
    expect(box(), "still asking").toBeTruthy();
    act(() => root.unmount());
  });

  it("does not remember a ticked cancel", async () => {
    const seen: boolean[] = [];
    const { container, root } = mountSuppress((v) => seen.push(v));
    await open(container);
    await act(async () => box()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    clickBodyButton("No");
    await act(async () => {});
    expect(seen).toEqual([false]);

    await open(container);
    expect(box(), "dialog should open again after cancel").toBeTruthy();
    act(() => root.unmount());
  });

  // A tick must not carry into the next dialog.
  it("does not carry a tick into the next dialog", async () => {
    const { container, root } = mountSuppress(() => {});
    await open(container);
    await act(async () => box()!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    clickBodyButton("No");
    await act(async () => {});
    await open(container);
    expect(box()!.checked, "the box opens unticked").toBe(false);
    act(() => root.unmount());
  });
});
