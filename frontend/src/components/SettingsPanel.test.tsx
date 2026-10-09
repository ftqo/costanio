import { test, expect, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPanel, useAppSettings } from "./SettingsPanel";
import { i18n } from "@lingui/core";
import { CB_MODE_LABELS, readCbMode, setCbMode } from "@/lib/colorblind";
import { LOCALE_LABELS } from "@/lib/i18n";
import { PLACEMENT_MARKS_LABEL, placementMarks } from "@/lib/placementMarks";

// The mode labels are message descriptors; i18n._ renders one in the active
// locale (English in tests).
const label = (m: keyof typeof CB_MODE_LABELS) => i18n._(CB_MODE_LABELS[m].label);
const hint = (m: keyof typeof CB_MODE_LABELS) => i18n._(CB_MODE_LABELS[m].hint);

// The panel's volume slider is a Radix primitive that measures its own thumb,
// and jsdom has no ResizeObserver. Nothing here depends on the measurement.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeEach(() => {
  localStorage.clear();
  setCbMode("off");
});
afterEach(() => {
  document.body.innerHTML = "";
});

/** Mounts the panel over the real settings hook, the way the header does. */
function Harness() {
  return <SettingsPanel settings={useAppSettings()} />;
}

function render() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  act(() => createRoot(el).render(<Harness />));
  return el;
}

const modeButtons = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("button")).filter((b) =>
    Object.keys(CB_MODE_LABELS).some(
      (m) => b.textContent === label(m as keyof typeof CB_MODE_LABELS),
    ),
  );

/** The colorblind switch specifically; the panel also has Sound and Music. */
function cbSwitch(el: HTMLElement): HTMLElement {
  const label = Array.from(el.querySelectorAll("label")).find((l) =>
    /Colorblind/i.test(l.textContent ?? ""),
  );
  const sw = label?.querySelector('button[role="switch"]');
  if (!sw) throw new Error("colorblind switch not found");
  return sw as HTMLElement;
}

/** The legal-spot highlight switch, found by its own label for the same reason. */
function markSwitch(el: HTMLElement): HTMLElement {
  const name = i18n._(PLACEMENT_MARKS_LABEL.name);
  const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent === name);
  const sw = label?.querySelector('button[role="switch"]');
  if (!sw) throw new Error("placement-marks switch not found");
  return sw as HTMLElement;
}

test("hides the deficiency picker until colorblind mode is on", () => {
  const el = render();
  expect(modeButtons(el)).toHaveLength(0);
  act(() => setCbMode("deutan"));
  // One button per mode, so a player can move off the default.
  expect(modeButtons(el)).toHaveLength(Object.keys(CB_MODE_LABELS).length);
});

test("shows the active mode as pressed", () => {
  act(() => setCbMode("tritan"));
  const el = render();
  const pressed = modeButtons(el).filter((b) => b.getAttribute("aria-pressed") === "true");
  expect(pressed).toHaveLength(1);
  expect(pressed[0].textContent).toBe(label("tritan"));
});

test("persists the chosen deficiency", () => {
  act(() => setCbMode("deutan"));
  const el = render();
  const protan = modeButtons(el).find((b) => b.textContent === label("protan"))!;
  act(() => protan.click());
  expect(readCbMode()).toBe("protan");
  expect(localStorage.getItem("costan.colorblind")).toBe("protan");
});

test("shows each mode's clinical name as a tooltip", () => {
  // The labels are plain language; the diagnosis is the hover text.
  act(() => setCbMode("deutan"));
  const el = render();
  for (const b of modeButtons(el)) {
    const mode = (Object.keys(CB_MODE_LABELS) as (keyof typeof CB_MODE_LABELS)[]).find(
      (m) => label(m) === b.textContent,
    )!;
    expect(b.getAttribute("title")).toBe(hint(mode));
  }
});

test("switch toggles between deutan and off", () => {
  const el = render();
  const sw = cbSwitch(el);
  act(() => sw.click());
  // Turning it on picks deutan, the most common.
  expect(readCbMode()).toBe("deutan");
  act(() => cbSwitch(el).click());
  expect(readCbMode()).toBe("off");
});

test("switching off hides the picker for a stored mode", () => {
  act(() => setCbMode("tritan"));
  const el = render();
  act(() => cbSwitch(el).click());
  expect(readCbMode()).toBe("off");
  expect(modeButtons(el)).toHaveLength(0);
});

test("legal-spot highlight switch defaults on and persists", () => {
  // Through the real `useAppSettings`, so the test proves the switch writes the
  // module the game route subscribes to.
  const el = render();
  const sw = markSwitch(el);
  expect(sw.getAttribute("aria-checked")).toBe("true");
  act(() => sw.click());
  expect(placementMarks()).toBe(false);
  expect(markSwitch(el).getAttribute("aria-checked")).toBe("false");
  act(() => markSwitch(el).click());
  expect(placementMarks()).toBe(true);
});

test("has no language picker", () => {
  // The language picker lives in components/LanguagePicker, reachable when
  // signed out. See LanguagePicker.test.tsx.
  const el = render();
  const named = Array.from(el.querySelectorAll("button")).filter((b) =>
    Object.values(LOCALE_LABELS).includes(b.textContent ?? ""),
  );
  expect(named).toHaveLength(0);
  expect(el.textContent ?? "").not.toContain("Report a translation problem");
});
