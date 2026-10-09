import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The game screen cannot be mounted in jsdom (WebGL board, websocket), so this
// pins the wiring at the source level, like the other Game.* guards. What the
// hold does to a control is rendered in components/game/CommandHold.test.
//
// While the board loads behind its entry cover, the game's own controls are
// shown disabled and no command leaves; the header, menus, chat, log, seat
// rail, settings and Leave stay live.
const src = readFileSync(join(process.cwd(), "src/routes/Game.tsx"), "utf8");

/** The text of `const name = ...;`. */
function decl(name: string): string {
  const at = src.indexOf(`const ${name} =`);
  expect(at, name).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf(";", at));
}

it("the hold is the entry gate", () => {
  expect(src).toMatch(/const entryHeld = !entry\.ready;/);
});

it("no command leaves while the board is loading", () => {
  const at = src.indexOf("function cmd(type: string, data?: unknown)");
  expect(at).toBeGreaterThan(-1);
  // Before an id is minted or the socket is touched.
  const body = src.slice(at, src.indexOf("gameSocket.cmd(", at));
  expect(body).toMatch(/if \(entryHeld\) return null;/);
  expect(body.indexOf("entryHeld")).toBeLessThan(body.indexOf("nextCmdId()"));
});

it("every turn gate the controls derive from is closed by the hold", () => {
  // The dice, End turn, every shelf tile, the dev and progress cards and the
  // trade panel's answers all read one of these.
  for (const gate of ["canRoll", "canTurnAction", "canAct", "canPlayDev", "canCounter"]) {
    expect(decl(gate), gate).toMatch(/!entryHeld/);
  }
});

it("the screen provides the hold, and the floating offers read it", () => {
  expect(src).toMatch(/<CommandHoldContext value=\{entryHeld\}>\{screen\}<\/CommandHoldContext>/);
  for (const card of ["<ActiveOfferCard", "<DrawOfferCard"]) {
    const at = src.indexOf(card);
    expect(src.slice(at - 80, at), card).toContain("<HeldActions>");
  }
  // The forced discard's Confirm sits on the shelf, outside any dialog.
  expect(src).toMatch(/disabled=\{discardSum !== discardNeed \|\| entryHeld\}/);
});

it("the host's reset confirm is a table action, not held", () => {
  const at = src.indexOf("<Overlay title={t`Reset to lobby?`}");
  expect(src.slice(at - 80, at)).toContain("<CommandHoldContext value={false}>");
});
