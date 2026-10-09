import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { LanguagePicker } from "./LanguagePicker";
import { LocaleProvider } from "@/lib/LocaleProvider";
import { LOCALE_LABELS, LANG_STORAGE_KEY, RELEASED_LOCALES, activateLocale } from "@/lib/i18n";
import { DISCORD_INVITE_URL } from "@/lib/links";

// The Activity is a per-test flag; only the last test sets it.
const h = vi.hoisted(() => ({ activity: false }));
vi.mock("@/lib/activity", () => ({ inActivityMode: () => h.activity }));

/**
 * The picker as a signed-out visitor uses it: no account, session or router.
 * Language is a per-browser preference (localStorage), the same for guests and
 * accounts.
 */

// React 18+ wants this flag before act() drives an async render (the provider
// loads a catalogue).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Wait for the catalogue behind a choice to land: `setLocale` awaits a dynamic
 * import before writing storage, so poll rather than sleep.
 */
const settled = (check: () => void) => vi.waitFor(() => act(async () => check()));

beforeEach(() => {
  localStorage.clear();
  h.activity = false;
});
afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

/** Mounted under the real provider, so `persist` really writes storage. */
async function render() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(
      <LocaleProvider>
        <LanguagePicker />
      </LocaleProvider>,
    );
  });
  return el;
}

const trigger = (el: HTMLElement) => el.querySelector("button")!;
const options = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));

test("shows one closed control naming the current language", async () => {
  const el = await render();
  // Closed: a single control, whatever the number of languages.
  expect(options(el)).toHaveLength(0);
  expect(trigger(el).getAttribute("aria-expanded")).toBe("false");
  expect(trigger(el).textContent).toContain(LOCALE_LABELS.en);
  // The word "Language" is in the button's content, visually hidden.
  expect(trigger(el).textContent).toContain("Language");

  await act(async () => trigger(el).click());
  expect(trigger(el).getAttribute("aria-expanded")).toBe("true");
});

test("lists every released language by its own name", async () => {
  const el = await render();
  await act(async () => trigger(el).click());
  const opts = options(el);
  expect(opts).toHaveLength(RELEASED_LOCALES.length);
  expect(RELEASED_LOCALES.length).toBe(18);
  expect(opts.map((b) => b.textContent).sort()).toEqual(
    RELEASED_LOCALES.map((l) => LOCALE_LABELS[l]).sort(),
  );
  // Each language is named in itself, not in the current UI language.
  for (const b of opts) expect(b.textContent).not.toMatch(/^(German|Japanese|Polish)$/);
  // Each row is tagged with the language it names, so a screen reader switches
  // voice and the per-script font stack applies.
  for (const b of opts) expect(b.getAttribute("lang")).toBeTruthy();
});

test("marks the current language as checked", async () => {
  const el = await render();
  await act(async () => trigger(el).click());
  const checked = options(el).filter((b) => b.getAttribute("aria-checked") === "true");
  expect(checked).toHaveLength(1);
  expect(checked[0].textContent).toBe(LOCALE_LABELS.en);
});

test("applies and persists a signed-out choice", async () => {
  const el = await render();
  await act(async () => trigger(el).click());
  const de = options(el).find((b) => b.textContent === LOCALE_LABELS.de)!;
  await act(async () => de.click());

  // Persisted: `resolveLocale` reads this key first. The server stores no
  // language.
  await settled(() => {
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });
  // Applied, and the menu closed.
  expect(trigger(el).textContent).toContain(LOCALE_LABELS.de);
  expect(options(el)).toHaveLength(0);

  await act(async () => {
    await activateLocale("en");
  });
});

test("offers a way to report translation problems in the menu", async () => {
  const el = await render();
  await act(async () => trigger(el).click());
  const text = el.textContent ?? "";
  expect(text).toContain("Report a translation problem");

  const link = Array.from(el.querySelectorAll("a")).find((a) =>
    /Discord/.test(a.textContent ?? ""),
  );
  expect(link, "no feedback link beside the notice").toBeTruthy();
  // The same Discord invite as the footer and /support.
  expect(link!.getAttribute("href")).toBe(DISCORD_INVITE_URL);
  expect(link!.getAttribute("rel")).toBe("noreferrer");
});

test("works from the keyboard", async () => {
  const el = await render();
  await act(async () => trigger(el).click());
  // Opening puts focus on the current language, so arrows walk the list
  // without a tab into it first.
  const opts = options(el);
  expect(document.activeElement).toBe(opts.find((b) => b.getAttribute("aria-checked") === "true"));

  const list = el.querySelector<HTMLElement>('[role="menu"]')!;
  await act(async () => {
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.activeElement).toBe(opts[1]);

  // Escape closes and returns focus to the trigger.
  await act(async () => {
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(options(el)).toHaveLength(0);
  expect(document.activeElement).toBe(trigger(el));

  // Every option is a real <button>, so Enter and Space work natively. (The
  // shared ui/menu uses divs, so this control does not reuse it.)
  await act(async () => trigger(el).click());
  for (const b of options(el)) expect(b.tagName).toBe("BUTTON");
});

test("renders the report link as plain text in the Discord Activity", async () => {
  // The lobby headers draw the picker without an Activity guard, so the
  // picker itself must drop external links there: from Discord's sandboxed
  // iframe a `target="_blank"` either does nothing or pulls the player out of
  // the call.
  h.activity = true;
  const el = await render();
  await act(async () => trigger(el).click());

  // The sentence naming Discord stays as text (as in components/StoreShelves).
  expect(el.textContent).toContain("Report a translation problem on Discord");
  // No links.
  expect(Array.from(el.querySelectorAll("a"))).toEqual([]);
  expect(el.innerHTML).not.toContain(DISCORD_INVITE_URL);
});
