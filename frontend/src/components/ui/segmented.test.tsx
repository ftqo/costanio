import { test, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Segmented } from "./segmented";

afterEach(() => {
  document.body.innerHTML = "";
});

function render(ui: React.ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  return { el, root };
}

const OPTS = [
  { label: "Overview", value: "overview" },
  { label: "Details", value: "details" },
];

test("Segmented pills: active is ink-filled, inactive is lifted", () => {
  const { el } = render(<Segmented value="overview" onChange={() => {}} options={OPTS} />);
  const [active, inactive] = Array.from(el.querySelectorAll("button"));
  expect(active.getAttribute("aria-pressed")).toBe("true");
  expect(active.classList.contains("bg-selected")).toBe(true);
  expect(inactive.getAttribute("aria-pressed")).toBe("false");
  expect(inactive.classList.contains("shadow-hard-sm")).toBe(true);
});

test("Segmented joined: bordered capsule of flat equal segments", () => {
  const { el } = render(
    <Segmented variant="joined" value="overview" onChange={() => {}} options={OPTS} />,
  );
  const wrap = el.firstElementChild as HTMLElement;
  // A 1px rim on the control radius (the HUD restores its 2px capsule via `data-ui-seg`).
  expect(wrap.classList.contains("border")).toBe(true);
  expect(wrap.classList.contains("rounded-control")).toBe(true);
  expect(wrap.hasAttribute("data-ui-seg")).toBe(true);
  expect(wrap.classList.contains("auto-cols-fr")).toBe(true);
  const [active, inactive] = Array.from(el.querySelectorAll("button"));
  expect(active.getAttribute("aria-pressed")).toBe("true");
  expect(active.classList.contains("text-selected-ink")).toBe(true);
  expect(inactive.getAttribute("aria-pressed")).toBe("false");
  for (const b of [active, inactive]) {
    for (const c of Array.from(b.classList)) {
      expect(c).not.toMatch(/shadow-shadow|translate-[xy]-boxShadow/);
    }
  }
});

test("Segmented joined: thumb follows the active segment", () => {
  const { el, root } = render(
    <Segmented variant="joined" value="overview" onChange={() => {}} options={OPTS} />,
  );
  const thumb = () => el.querySelector("span[aria-hidden]") as HTMLElement;
  // An ink thumb with a soft lift and no outline.
  expect(thumb().classList.contains("bg-selected")).toBe(true);
  expect(thumb().classList.contains("border-2")).toBe(false);
  expect(thumb().classList.contains("transition-transform")).toBe(true);
  expect(thumb().style.transform).toBe("translateX(0%)");
  act(() =>
    root.render(<Segmented variant="joined" value="details" onChange={() => {}} options={OPTS} />),
  );
  expect(thumb().style.transform).toBe("translateX(100%)");
});

test("Segmented joined: clicking a segment reports its value", () => {
  let picked = "";
  const { el } = render(
    <Segmented variant="joined" value="overview" onChange={(v) => (picked = v)} options={OPTS} />,
  );
  const details = Array.from(el.querySelectorAll("button")).find(
    (b) => b.textContent === "Details",
  )!;
  act(() => details.click());
  expect(picked).toBe("details");
});
