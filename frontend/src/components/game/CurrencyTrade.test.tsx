import { afterEach, expect, test } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { CurrencyTrade } from "./CurrencyTrade";

i18n.load("en", {});
i18n.activate("en");
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
});

// Each purse in a player trade is drawn as what it is: gold (Raiders' or the
// wagon's) as bullion, Rivers' coins as a coin, so Raiders + Rivers doesn't show
// two identical pictures.
test("gold rows draw the bars and the coin row keeps the coin", () => {
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() =>
    root.render(
      <I18nProvider i18n={i18n}>
        <CurrencyTrade
          currencies={[
            { key: "coins", held: 2 },
            { key: "gold", held: 3 },
            { key: "wagon_gold", held: 1 },
          ]}
          give={{}}
          want={{}}
          onGive={() => {}}
          onWant={() => {}}
        />
      </I18nProvider>,
    ),
  );
  const row = (k: string) => el.querySelector(`[data-trade-currency="${k}"]`)!;
  expect(row("gold").querySelector('svg[data-glyph="gold"]')).not.toBeNull();
  expect(row("wagon_gold").querySelector('svg[data-glyph="gold"]')).not.toBeNull();
  expect(row("coins").querySelector('svg[data-glyph="gold"]')).toBeNull();
  expect(row("coins").querySelector("svg")).not.toBeNull();
});
