import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeOrb } from "./ThemeOrb";

// jsdom has real localStorage and a real root classList, which is all
// `lib/theme` touches, so both are asserted directly.

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.removeItem("theme");
  document.documentElement.classList.remove("dark");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  localStorage.removeItem("theme");
  document.documentElement.classList.remove("dark");
});

function button() {
  return host.querySelector("button")!;
}

describe("ThemeOrb", () => {
  it("starts light with no stored pref", () => {
    act(() => root.render(<ThemeOrb />));
    expect(button().getAttribute("aria-label")).toBe("Switch to dark mode");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggles light and dark on click, persisting the choice", () => {
    act(() => root.render(<ThemeOrb />));

    act(() => button().click());
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(button().getAttribute("aria-label")).toBe("Switch to light mode");

    act(() => button().click());
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(button().getAttribute("aria-label")).toBe("Switch to dark mode");
  });

  it("from a stored system pref, the first click flips the resolved theme", () => {
    localStorage.setItem("theme", "system");
    // jsdom has no matchMedia, so `system` resolves to "light" (lib/theme's
    // `typeof matchMedia` guard); the orb must flip away from that.
    act(() => root.render(<ThemeOrb />));
    expect(button().getAttribute("aria-label")).toBe("Switch to dark mode");

    act(() => button().click());
    // The click always lands on an explicit choice, never back on "system".
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("picks up a theme change made elsewhere", () => {
    act(() => root.render(<ThemeOrb />));
    expect(button().getAttribute("aria-label")).toBe("Switch to dark mode");

    // Simulate SettingsPanel calling applyTheme directly, bypassing this orb.
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.add("dark");

    // No click on the orb, just a re-render, as websocket frames cause in a
    // live game.
    act(() => root.render(<ThemeOrb />));
    expect(button().getAttribute("aria-label")).toBe("Switch to light mode");
  });
});
