import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider, TOAST_INSET_GAP, useToast, useToastInset } from "./toast";

// Toasts must be announced. A live region only announces changes made after it
// exists, so these check that the region is mounted empty first and the toast
// is inserted inside it.

let host: HTMLDivElement;
let root: Root;

// A button that raises whichever toast the test asks for.
function Harness({ message, variant }: { message: string; variant: "error" | "info" }) {
  const toast = useToast();
  return (
    <button data-testid="go" onClick={() => toast[variant](message)}>
      go
    </button>
  );
}

function mount(message: string, variant: "error" | "info" = "info") {
  act(() =>
    root.render(
      <ToastProvider>
        <Harness message={message} variant={variant} />
      </ToastProvider>,
    ),
  );
}

function raise() {
  act(() => {
    host
      .querySelector('[data-testid="go"]')!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const region = (role: "status" | "alert") =>
  document.body.querySelector<HTMLElement>(`[role="${role}"]`);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("toast live regions", () => {
  it("mounts both live regions up front", () => {
    mount("never raised");
    expect(region("status")).not.toBeNull();
    expect(region("alert")).not.toBeNull();
    expect(region("status")!.textContent).toBe("");
    expect(region("alert")!.textContent).toBe("");
  });

  it("renders an info toast in the existing polite region", () => {
    mount("Report submitted");
    const before = region("status")!;
    raise();
    // The same element, now with the message: a mutation the reader announces.
    expect(region("status")).toBe(before);
    expect(before.textContent).toContain("Report submitted");
  });

  it("renders an error in the assertive region", () => {
    // Errors interrupt; they are how the app reports a refused action.
    mount("Not your turn", "error");
    raise();
    expect(region("alert")!.textContent).toContain("Not your turn");
    expect(region("status")!.textContent).not.toContain("Not your turn");
  });

  it("gives the toast no role", () => {
    // The toast is content inside a region, not a region itself.
    mount("Report submitted");
    raise();
    const toast = region("status")!.firstElementChild!;
    expect(toast.textContent).toContain("Report submitted");
    expect(toast.getAttribute("role")).toBeNull();
    expect(toast.getAttribute("aria-live")).toBeNull();
  });

  it("sets aria-atomic false on both regions", () => {
    // `role="alert"` implies `aria-atomic`, which would re-read the region on every addition.
    mount("Not your turn", "error");
    expect(region("alert")!.getAttribute("aria-atomic")).toBe("false");
    expect(region("status")!.getAttribute("aria-atomic")).toBe("false");
  });
});

// The game pins the dice and End turn to the bottom-right corner, where the
// stack would cover them. `useToastInset` lifts the stack above a screen's
// bottom row; unmounting puts it back.
describe("toast inset", () => {
  function Inset({ px }: { px: number }) {
    useToastInset(px);
    return null;
  }
  const stack = () => document.body.querySelector<HTMLElement>("[data-toast-stack]")!;

  it("sits in the corner by default", () => {
    mount("hello");
    expect(stack().style.bottom).toBe("");
  });

  it("lifts above the inset and resets on unmount", () => {
    const render = (px: number | null) =>
      act(() =>
        root.render(
          <ToastProvider>
            {px !== null && <Inset px={px} />}
            <Harness message="Time ran out" variant="info" />
          </ToastProvider>,
        ),
      );
    render(120);
    expect(stack().style.bottom).toBe(`${120 + TOAST_INSET_GAP}px`);
    render(180);
    expect(stack().style.bottom).toBe(`${180 + TOAST_INSET_GAP}px`);
    render(null);
    expect(stack().style.bottom).toBe("");
  });

  it("ignores a zero inset", () => {
    act(() =>
      root.render(
        <ToastProvider>
          <Inset px={0} />
        </ToastProvider>,
      ),
    );
    expect(stack().style.bottom).toBe("");
  });
});
