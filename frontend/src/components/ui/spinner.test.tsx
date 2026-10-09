import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Spinner } from "./spinner";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(node: React.ReactNode) {
  const el = document.createElement("div");
  const root = createRoot(el);
  act(() => root.render(node));
  return el;
}

test("Spinner: spins and is decorative by default", () => {
  const svg = render(<Spinner />).querySelector("svg")!;
  expect(svg).toBeTruthy();
  expect(svg.classList.contains("animate-spin")).toBe(true);
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.getAttribute("role")).toBe(null);
});

test("Spinner: a labelled spinner announces itself as a status", () => {
  const svg = render(<Spinner label="Loading game" />).querySelector("svg")!;
  expect(svg.getAttribute("role")).toBe("status");
  expect(svg.getAttribute("aria-label")).toBe("Loading game");
  expect(svg.getAttribute("aria-hidden")).toBe(null);
});
