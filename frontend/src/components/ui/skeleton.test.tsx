import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Skeleton } from "./skeleton";

afterEach(() => {
  document.body.innerHTML = "";
});

test("Skeleton: decorative pulsing block sized by className", () => {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(<Skeleton className="h-4 w-20" />));
  const box = el.firstElementChild as HTMLElement;
  expect(box.classList.contains("animate-pulse")).toBe(true);
  expect(box.classList.contains("h-4")).toBe(true);
  expect(box.classList.contains("w-20")).toBe(true);
  expect(box.getAttribute("aria-hidden")).toBe("true");
});
