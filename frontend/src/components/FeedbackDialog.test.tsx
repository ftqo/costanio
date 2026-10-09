import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const h = vi.hoisted(() => ({ feedback: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { feedback: h.feedback },
}));

import { ApiErr } from "@/lib/api";
import { FeedbackDialog, FEEDBACK_MAX } from "./FeedbackDialog";

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
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const box = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );

// React tracks a controlled field's value itself, so set it the way the
// browser does and let React see the input event.
function type(text: string) {
  act(() => {
    Reflect.set(HTMLTextAreaElement.prototype, "value", text, box());
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function send() {
  await act(async () => button("Send")!.click());
}

describe("FeedbackDialog", () => {
  test("renders nothing while closed", () => {
    act(() => root.render(<FeedbackDialog open={false} onOpenChange={() => {}} />));
    expect(box()).toBeNull();
  });

  test("holds Send until something is written, and caps the length", () => {
    act(() => root.render(<FeedbackDialog open onOpenChange={() => {}} />));
    expect(box().maxLength).toBe(FEEDBACK_MAX);
    expect(button("Send")!.disabled).toBe(true);
    type("   ");
    expect(button("Send")!.disabled).toBe(true);
    type("the robber is hard to see");
    expect(button("Send")!.disabled).toBe(false);
  });

  test("sends the message with the current path and thanks the player", async () => {
    h.feedback.mockResolvedValue(undefined);
    window.history.pushState({}, "", "/lobby?invite=abc");
    act(() => root.render(<FeedbackDialog open onOpenChange={() => {}} />));
    type("the robber is hard to see");
    await send();
    expect(h.feedback).toHaveBeenCalledWith("the robber is hard to see", "/lobby");
    expect(document.body.textContent).toContain("Thanks. Your feedback was sent.");
    expect(box()).toBeNull();
  });

  test("shows the server's refusal and keeps what was written", async () => {
    h.feedback.mockRejectedValue(new ApiErr(429, "FEEDBACK_RATE_LIMITED"));
    act(() => root.render(<FeedbackDialog open onOpenChange={() => {}} />));
    type("again");
    await send();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "You've sent a lot of feedback. Wait a minute and try again.",
    );
    expect(box().value).toBe("again");
    expect(button("Send")!.disabled).toBe(false);
  });

  test("starts empty each time it opens", () => {
    act(() => root.render(<FeedbackDialog open onOpenChange={() => {}} />));
    type("half a thought");
    act(() => root.render(<FeedbackDialog open={false} onOpenChange={() => {}} />));
    act(() => root.render(<FeedbackDialog open onOpenChange={() => {}} />));
    expect(box().value).toBe("");
  });
});
