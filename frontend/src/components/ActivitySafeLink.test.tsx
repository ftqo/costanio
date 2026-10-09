import { afterEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { ActivitySafeLink } from "./ActivitySafeLink";

const mode = vi.hoisted(() => ({ activity: false }));
vi.mock("@/lib/activity", () => ({ inActivityMode: () => mode.activity }));

let root: Root;
let host: HTMLDivElement;

function render(activity: boolean) {
  mode.activity = activity;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const onClick = vi.fn((event) => event.preventDefault());
  act(() =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ActivitySafeLink>
          <a href="/replay?g=game&inv=invite" target="_blank" onClick={onClick}>
            Watch replay
          </a>
        </ActivitySafeLink>
      </I18nProvider>,
    ),
  );
  return onClick;
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

test("in Discord, drops the link and handler and shows a tooltip", () => {
  const onClick = render(true);
  expect(host.querySelector("a, [href], [target]")).toBeNull();
  const trigger = host.querySelector<HTMLElement>('[role="link"]')!;
  expect(trigger.getAttribute("aria-disabled")).toBe("true");
  expect(trigger.textContent).toBe("Watch replay");
  act(() => trigger.click());
  expect(onClick).not.toHaveBeenCalled();
  act(() => trigger.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "This functionality is available on the website",
  );
  act(() => trigger.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  act(() => trigger.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "This functionality is available on the website",
  );
});

test("on the web, keeps the link, invite, new tab and handler", () => {
  const onClick = render(false);
  const link = host.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("/replay?g=game&inv=invite");
  expect(link.target).toBe("_blank");
  expect(link.hasAttribute("aria-disabled")).toBe(false);
  act(() => link.click());
  expect(onClick).toHaveBeenCalledOnce();
});
