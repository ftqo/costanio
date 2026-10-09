import { test, expect, afterEach } from "vitest";
import { applyTheme, resolveTheme } from "./theme";

afterEach(() => {
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  document.querySelector('meta[name="theme-color"]')?.remove();
  localStorage.clear();
});

test("resolveTheme: explicit prefs ignore system", () => {
  expect(resolveTheme("light", true)).toBe("light");
  expect(resolveTheme("dark", false)).toBe("dark");
});

test("resolveTheme: system follows the OS preference", () => {
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
});

// The class styles the page; color-scheme tells the browser, which paints the
// base canvas (the white flash on a full load), scrollbars and the mobile
// overscroll area. Both must change together.
//
// jsdom loads no stylesheet, so --background is set on the root as index.css
// would.
test("applyTheme sets the class, color-scheme and theme-color", () => {
  const root = document.documentElement;
  root.style.setProperty("--background", "#05070d");
  applyTheme("dark");
  expect(root.classList.contains("dark")).toBe(true);
  expect(root.style.colorScheme).toBe("dark");
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
    "#05070d",
  );

  // And back, reusing the one meta tag.
  root.style.setProperty("--background", "#1159c1");
  applyTheme("light");
  expect(root.classList.contains("dark")).toBe(false);
  expect(root.style.colorScheme).toBe("light");
  expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
    "#1159c1",
  );
});

// With no --background yet (before the stylesheet lands) the scheme is still
// set; only the address bar colour waits.
test("applyTheme sets the scheme before --background exists", () => {
  applyTheme("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
});
