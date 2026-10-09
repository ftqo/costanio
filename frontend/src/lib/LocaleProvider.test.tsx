import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "./LocaleProvider";
import { LANG_STORAGE_KEY } from "./i18n";

/**
 * A catalogue that fails to load must not leave a blank page. `ready` gates
 * the whole app, so this mounts the real provider over a catalogue that
 * refuses to load and checks something renders.
 */
vi.mock("@/locales/de/messages.po", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let errors: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  // The fallback logs an error; the suite does not need it.
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errors.mockRestore();
  document.body.innerHTML = "";
  localStorage.clear();
});

/**
 * Wait for the tree under the provider to appear.
 *
 * Polls on real timers rather than ticking inside `act`: the catalogue is a
 * real dynamic import (a macrotask), and an `act` scope that throws leaves
 * React's queue unflushed, so retrying inside `act` never recovers.
 */
async function settled(el: HTMLElement) {
  await vi.waitFor(() => expect(el.textContent).not.toBe(""), { timeout: 15_000, interval: 25 });
  await act(async () => {});
}

async function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(
      <LocaleProvider>
        <p>the app</p>
      </LocaleProvider>,
    );
  });
  return el;
}

test("falls back to English when the catalogue fails to load", async () => {
  localStorage.setItem(LANG_STORAGE_KEY, "de");
  const el = await mount();
  await settled(el);
  expect(el.textContent).toBe("the app");
  // `<html lang>` reflects the language actually shown.
  expect(document.documentElement.lang).toBe("en");
}, 20_000);

test("renders in the chosen language when the catalogue loads", async () => {
  localStorage.setItem(LANG_STORAGE_KEY, "fr");
  const el = await mount();
  await settled(el);
  expect(el.textContent).toBe("the app");
  expect(document.documentElement.lang).toBe("fr");
}, 20_000);
