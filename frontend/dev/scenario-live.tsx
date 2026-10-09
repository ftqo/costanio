// Development workbench for actual scenario controls; excluded from the production entry.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "@lingui/core";
import { activateLocale, isLocale } from "../src/lib/i18n";
import "../src/index.css";
import { previewView } from "../src/lib/board3d/previewFixture";
import { WagonPanel } from "../src/components/game/WagonPanel";
import { ExplorersPanel } from "../src/components/game/ExplorersPanel";
import { FishSpendPanel } from "../src/components/game/FishSpendPanel";
import { RiverCoinsPanel } from "../src/components/game/RiverCoinsPanel";
import { RaidersGoldPanel } from "../src/components/game/RaidersGoldPanel";
import { RaidersRidersPanel } from "../src/components/game/RaidersRidersPanel";
import { RaidersTreasonPanel } from "../src/components/game/RaidersTreasonPanel";
import { CamelBidPanel } from "../src/components/game/CamelBidPanel";
import { CamelPlacePanel } from "../src/components/game/CamelPlacePanel";
import { ExpansionShelf } from "../src/components/lobby/ExpansionShelf";
import { coinTrades } from "../src/lib/rivers";
import { goldBuyOffers, goldSellOffers } from "../src/lib/raiders";
import { PillageBuyoutDialog } from "../src/components/game/PillageBuyoutDialog";
import { fishOffers, type FishMix } from "../src/lib/fish";
import { gameCaps } from "../src/lib/caps";
import { buyoutWealthCost } from "../src/lib/rivers";
import all4 from "../src/lib/__fixtures__/scenarioAll4View.json";
import knightsRivers from "../src/lib/__fixtures__/scenarioKnightsRiversView.json";
import type { CamelPath, CaravansExt, FullView, Hand } from "../src/lib/types";
import { gameSocket, type State } from "../src/lib/ws";
i18n.load("en", {});
i18n.activate("en");
// ?lang=de (or ru...) runs the panels in a long-string locale.
const benchLang = new URLSearchParams(location.search).get("lang");
const a = { q: 0, r: 0, side: 0 } as const;
const b = { q: 0, r: 0, side: 1 } as const;
const e = { a, b };
const hand = [0, 4, 2, 3, 1, 0] as Hand;
const view = {
  ...previewView,
  viewer: 0,
  cur: 0,
  phase: "play",
  rolled: true,
  players: [{ ...previewView.players[0], hand }],
  bank: [0, 19, 0, 19, 19, 19],
  bank_ratios: [0, 2, 4, 3, 4, 4],
  legal: { wagon_steps: [b], explorer_ships: [{ ship: 1, moves: [e], acts: [], left: 4 }] },
  ext: {
    wagons: {
      has_trade: true,
      started: true,
      turn_seat: 0,
      barb_seat: -1,
      level: [3],
      gold: [5],
      cargo: [1],
      delivered: [2],
      mp_track: [4, 5, 6, 7, 7],
      drive_floors: [7, 6, 5, 4, 3],
      wagons: [{ player: 0, v: a }],
      barbarians: [e],
      trade: [{ role: 0, accepts: [1, 2], ships: [3, 4], left: 4, plaza: a, hex: a }],
    },
    rivers: { coins: [4], spends_left: 2, coin_per_res: 2 },
    raiders: { gold: [4], gold_buys_left: 2 },
    explorers: {
      movement: false,
      anchors: [a],
      ships: [
        { id: 1, owner: 0, e, left: 4, hold: { haul: 1 } },
        { id: 2, owner: 0, e, left: 2, hold: { crew: 1, spice: 1 } },
      ],
      seats: [
        {
          gold: 4,
          ships_left: 2,
          settlers_left: 2,
          crews_left: 4,
          harbours_left: 2,
          track: [2, 3, 1],
          villages: [[], [], [true]],
        },
      ],
    },
  },
} as unknown as FullView;
// Views captured from real games (base+caravans+fishermen+harbormaster+rivers,
// and base+cak+fishermen+rivers), so the panels below are priced by the same
// lib functions Game.tsx calls rather than by hand-written offers.
const live = all4 as unknown as FullView;
const kr = knightsRivers as unknown as FullView;
const liveHand = [0, 2, 3, 1, 2, 1] as Hand;
const riversOf = (v: FullView, patch: object) =>
  ({ ...v, ext: { ...v.ext, rivers: { ...(v.ext?.rivers as object), ...patch } } }) as FullView;
// A fish view with the robber on the board and a legal bridge and road, so every
// rung this ruleset sells is on the ladder (the 6-fish bridge included).
const fishView = (mix: FishMix) =>
  ({
    ...live,
    board: { ...live.board, robber: live.board.tiles.find((t) => t.res !== "sea")!.hex },
    legal: { roads: [e], bridges: [e] },
    ext: { ...live.ext, fishermen: { ...(live.ext?.fishermen as object), mix } },
  }) as FullView;
const liveCar = live.ext?.caravans as CaravansExt;
const spokes: CamelPath[] = (liveCar.caravans ?? []).map((c) => ({
  caravan: c.caravan,
  e: c.arrow,
}));
// The case the place panel handles: one edge offered by two caravans.
const shared: CamelPath[] = [...spokes, { caravan: 1, e: spokes[2]?.e ?? e }];
const names = [
  "Lobby",
  "Wagons",
  "Explorers",
  "Fish",
  "Coins",
  "Gold",
  "Riders",
  "Treason",
  "Fleet at sea",
  "Camel vote",
  "Camel placement",
  "Fish live",
  "Fish cap",
  "Coins live",
  "Coins knights",
  "Coins capped",
  "Camel vote live",
  "Camel place shared",
  "Camel place tie",
  "Pillage warn",
  "Pillage short",
];
function Bench() {
  const [panel, setPanel] = useState(new URLSearchParams(location.search).get("panel") ?? "Lobby");
  const [movement, setMovement] = useState(false);
  const [last, setLast] = useState("");
  const close = () => setPanel("Lobby");
  const action = (...args: unknown[]) => setLast(JSON.stringify(args));
  const x = {
    ...view,
    ext: { ...view.ext, explorers: { ...view.ext?.explorers, movement } },
  } as FullView;
  return (
    <I18nProvider i18n={i18n}>
      <main className="min-h-screen bg-background p-4 font-heading">
        <nav className="flex flex-wrap gap-2">
          {names.map((n) => (
            <button className="rounded border p-2" key={n} onClick={() => setPanel(n)}>
              {n}
            </button>
          ))}
        </nav>
        <p role="status" className="my-4">
          {last}
        </p>
        {panel === "Lobby" && (
          <ExpansionShelf
            exp={{
              islands: false,
              knights: false,
              fishermen: false,
              caravans: false,
              harbormaster: false,
              rivers: false,
              raiders: false,
              wagons: false,
              explorers: false,
            }}
            disabled={false}
            allowScenarios={false}
            onToggle={action}
          />
        )}
        {panel === "Wagons" && (
          <WagonPanel
            view={view}
            seat={0}
            onClose={close}
            onMove={action}
            onHalt={action}
            onBoost={action}
            onCharge={action}
            onUpgrade={action}
            onBuy={action}
            onSell={action}
            onSwift={action}
          />
        )}
        {panel === "Explorers" && (
          <ExplorersPanel
            view={x}
            seat={0}
            legal={view.legal}
            onClose={close}
            onArm={action}
            onSend={(cmd, data) => {
              action(cmd, data);
              if (cmd === "explorers_enter_movement") setMovement(true);
            }}
          />
        )}
        {panel === "Fish" && (
          <FishSpendPanel
            mix={[1, 2, 1]}
            offers={[
              { spend: "steal", cost: 3, pay: [1, 1, 0], waste: 0, affordable: true },
              { spend: "take_resource", cost: 4, pay: [0, 2, 0], waste: 0, affordable: true },
              { spend: "free_road", cost: 5, pay: [0, 1, 1], waste: 0, affordable: true },
            ]}
            onSpend={action}
            onClose={close}
          />
        )}
        {panel === "Coins" && (
          <RiverCoinsPanel
            trades={coinTrades(view, 0, (i) => hand[i], true)}
            onBuy={action}
            onSpend={action}
            onClose={close}
          />
        )}
        {panel === "Gold" && (
          <RaidersGoldPanel
            gold={4}
            buysLeft={2}
            buys={goldBuyOffers(view, 0)}
            sells={goldSellOffers(view, hand)}
            onBuy={action}
            onSell={action}
            onClose={close}
          />
        )}
        {panel === "Treason" && (
          <RaidersTreasonPanel
            board={view.board}
            ext={{
              coast: view.board.tiles
                .filter((t) => t.res !== "sea")
                .slice(0, 6)
                .map((t) => t.hex),
              raider_count: [2, 1, 0, 1, 0, 3],
              castle: view.board.tiles.filter((t) => t.res !== "sea")[8]?.hex,
            }}
            sources={view.board.tiles
              .filter((t) => t.res !== "sea")
              .slice(0, 6)
              .filter((_, i) => [0, 1, 3].includes(i))
              .map((t) => t.hex)}
            destinations={view.board.tiles
              .filter((t) => t.res !== "sea")
              .slice(0, 5)
              .map((t) => t.hex)}
            count={2}
            onPlan={action}
            onClose={close}
          />
        )}
        {panel === "Fleet at sea" && (
          <ExplorersPanel
            view={
              {
                ...x,
                ext: {
                  ...x.ext,
                  explorers: {
                    ...x.ext?.explorers,
                    movement: true,
                    ships: [
                      { id: 4, owner: 0, e, left: 3, hold: { settler: 1 } },
                      { id: 9, owner: 0, e, left: 0, done: true, hold: { crew: 2 } },
                      { id: 12, owner: 0, e, left: 4, sped: true, hold: { haul: 1, spice: 1 } },
                    ],
                    pirate: { q: 0, r: 0 },
                    pirate_owner: 1,
                  },
                },
              } as FullView
            }
            seat={0}
            legal={
              {
                explorer_ships: [
                  {
                    ship: 4,
                    from: e,
                    moves: [e],
                    acts: [
                      { job: "found", v: a },
                      { job: "land_crew", v: a },
                    ],
                    left: 3,
                  },
                  { ship: 12, from: e, moves: [e], acts: [{ job: "load_haul", v: a }], left: 4 },
                ],
              } as never
            }
            onClose={close}
            onArm={action}
            onSend={action}
          />
        )}
        {panel === "Riders" && (
          <RaidersRidersPanel
            moves={[
              { from: e, to: [e, e, e], hurry: [e, e], must_leave: true },
              { from: { a: b, b: { q: 1, r: 0, side: 0 } }, to: [e], hurry: [] },
              {
                from: { a: { q: 1, r: 0, side: 1 }, b: { q: 1, r: 1, side: 0 } },
                to: [],
                hurry: [],
              },
            ]}
            grain={1}
            fishHurry
            onChoose={action}
            onClose={close}
          />
        )}
        {panel === "Camel vote" && (
          <CamelBidPanel
            board={view.board}
            ext={{}}
            hand={hand}
            paths={[{ caravan: 0, e }]}
            pending={[1, 2]}
            seatName={(s) => `Player ${s + 1}`}
            onBid={action}
            onClose={close}
          />
        )}
        {panel === "Camel placement" && (
          <CamelPlacePanel
            board={view.board}
            ext={{}}
            paths={[{ caravan: 0, e }]}
            onPlace={action}
            onClose={close}
          />
        )}
        {panel === "Fish live" && (
          <FishSpendPanel
            mix={[1, 1, 1]}
            offers={fishOffers(fishView([1, 1, 1]), gameCaps(live), [1, 1, 1], true)}
            onSpend={action}
            onClose={close}
            onGiveBoot={action}
          />
        )}
        {panel === "Fish cap" && (
          <FishSpendPanel
            mix={[3, 2, 2]}
            offers={fishOffers(fishView([3, 2, 2]), gameCaps(live), [3, 2, 2], true)}
            onSpend={action}
            onClose={close}
          />
        )}
        {panel === "Coins live" && (
          <RiverCoinsPanel
            trades={coinTrades(
              riversOf(live, { coins: [5, 1, 0, 2] }),
              0,
              (i) => liveHand[i],
              true,
            )}
            onBuy={action}
            onSpend={action}
            onClose={close}
          />
        )}
        {panel === "Coins knights" && (
          <RiverCoinsPanel
            trades={coinTrades(
              {
                ...riversOf(kr, { coins: [3, 1, 0] }),
                ext: {
                  ...riversOf(kr, { coins: [3, 1, 0] }).ext,
                  cak: {
                    ...(kr.ext?.cak as object),
                    players: [{ commodities: [4, 1, 3] }],
                  },
                },
              } as FullView,
              0,
              (i) => liveHand[i],
              true,
            )}
            onBuy={action}
            onSpend={action}
            onSellGood={action}
            onClose={close}
          />
        )}
        {panel === "Coins capped" && (
          <RiverCoinsPanel
            trades={coinTrades(
              riversOf(live, { coins: [6, 1, 0, 2], spends_left: 0 }),
              0,
              (i) => liveHand[i],
              true,
            )}
            onBuy={action}
            onSpend={action}
            onClose={close}
          />
        )}
        {panel === "Camel vote live" && (
          <CamelBidPanel
            board={live.board}
            ext={{
              ...liveCar,
              bids: [
                { player: 1, cards: [2, 1], path: spokes[1] },
                { player: 2, cards: [0, 0] },
              ],
            }}
            buildings={live.buildings}
            colorOf={(s) => ["#ff0000", "#00ffff", "#0000ff", "#ffff00"][s]}
            hand={liveHand}
            paths={spokes}
            pending={[3]}
            seatName={(s) => live.seat_names?.[s] ?? `Player ${s + 1}`}
            onBid={action}
            onClose={close}
          />
        )}
        {panel === "Camel place shared" && (
          <CamelPlacePanel
            board={live.board}
            ext={liveCar}
            buildings={live.buildings}
            colorOf={(s) => ["#ff0000", "#00ffff", "#0000ff", "#ffff00"][s]}
            paths={shared}
            onPlace={action}
            onClose={close}
          />
        )}
        {panel === "Camel place tie" && (
          <CamelPlacePanel
            board={live.board}
            ext={{ ...liveCar, placer: 0, reason: "tie" }}
            paths={spokes}
            onPlace={action}
            onClose={close}
          />
        )}
        {panel === "Pillage warn" && (
          <PillageBuyoutDialog
            coins={5}
            afford
            cost={buyoutWealthCost(
              riversOf(kr, { coins: [5, 1, 2], wealthiest: 0, poorest: [false, true, false] }),
              0,
            )}
            onPay={action}
            onStandDown={close}
          />
        )}
        {panel === "Pillage short" && (
          <PillageBuyoutDialog
            coins={1}
            afford={false}
            cost={{ losesWealthiest: false, gainsPoorest: false, after: 0 }}
            onPay={action}
            onStandDown={close}
          />
        )}
      </main>
    </I18nProvider>
  );
}
// The camel panels' DecisionClock reads the game socket, which the bench never
// opens, so seed the slice it selects.
{
  const sock = gameSocket as unknown as { state: State };
  sock.state = {
    ...sock.state,
    full: {
      viewer: 0,
      config: { turn_timer_sec: 20 },
      seat_deadlines: { 0: 12_000 },
      seat_budgets: { 0: 20_000 },
    } as unknown as FullView,
  };
}
const mount = () => createRoot(document.getElementById("root")!).render(<Bench />);
if (benchLang && isLocale(benchLang)) void activateLocale(benchLang).then(mount, mount);
else mount();
