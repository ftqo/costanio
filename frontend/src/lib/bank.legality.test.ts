// The trade panel checks a basket's legality before sending, so the rule exists
// in `decideBankBasket` (Go) and `maritimeTrade` (here). Both are tested
// against one table: `engine.TestBankBasketFixture` writes the fixture after
// checking every row against the engine, and this checks `maritimeTrade`
// agrees.
//
// Refresh it with: go test ./engine -run TestBankBasketFixture -update
import { test, expect, describe } from "vitest";
import fixture from "./__fixtures__/bank-basket-legality.json";
import { maritimeTrade } from "./bank";

interface Row {
  name: string;
  ratios: number[];
  hand: number[];
  bank: number[];
  spend: number[];
  want: number[];
  legal: boolean;
  err?: string;
}

const cases = fixture.cases as Row[];

test("the fixture is present and covers both verdicts", () => {
  expect(cases.length).toBeGreaterThan(15);
  expect(cases.some((c) => c.legal)).toBe(true);
  expect(cases.some((c) => !c.legal)).toBe(true);
});

describe("maritimeTrade agrees with the engine", () => {
  for (const c of cases) {
    test(`${c.legal ? "accepts" : "refuses"}: ${c.name}`, () => {
      const plan = maritimeTrade(c.spend, c.want, c.ratios, c.bank, c.hand);
      if (!plan) {
        // A null plan means a side is empty, which the engine also refuses.
        expect(c.legal, `${c.name}: engine accepts it but the panel quotes nothing`).toBe(false);
        return;
      }
      expect(
        plan.ok,
        `${c.name}: panel says ${plan.ok}, engine says ${c.legal} (${c.err ?? "ok"})`,
      ).toBe(c.legal);
    });
  }
});

// Every rejected row must come back as a refused plan.
describe("every engine refusal is refused", () => {
  for (const c of cases.filter((r) => !r.legal)) {
    test(c.name, () => {
      const plan = maritimeTrade(c.spend, c.want, c.ratios, c.bank, c.hand);
      if (!plan) return; // empty side: the panel has nothing staged to judge
      expect(plan.ok, `${c.name}: refused by the engine, offered by the panel`).toBe(false);
    });
  }
});
