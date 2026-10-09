// What the board's dynamic pass draws, as one string, so the rebuild effect
// runs exactly when a piece moves.
//
// `view` is a fresh object on every server message, so the board keys its
// rebuild on what its piece passes read (see `piecesKey` in Board3D). A slice a
// pass reads but this omits is a piece that doesn't appear until something
// unrelated moves.
//
// The module half of the key is the module plans themselves: the placements
// the passes are about to draw. They are small pure functions of the view, so
// hashing them is cheap, and the key can't miss a piece. Keying on each
// module's whole ext slice would also work but would rebuild on changes nothing
// draws (Rivers' coins, Wagons' cargo, Explorers' crew counts). The test pins
// that a moved wagon, a sailed ship, a camel, a bridge and a weir each move
// the key.
import type { FullView } from "@/lib/types";
import { islandsExt, knightsExt, raidersExt } from "@/lib/types";
import { planBridges } from "./layers/rivers";
import { planCamels, planSpokes } from "./layers/caravans";
import { planWagons, planPathBarbarians } from "./layers/wagons";
import { planCargoShips, planCorsair, planQuays, planHolds } from "./layers/explorers";
import { planWeirs, planGroundChips } from "./layers/fishermen";

export function dynamicPiecesKey(view: FullView): string {
  return JSON.stringify([
    view.buildings,
    view.roads,
    view.board.robber,
    islandsExt(view),
    knightsExt(view),
    raidersExt(view),
    planBridges(view),
    planCamels(view),
    planSpokes(view),
    planWagons(view),
    planPathBarbarians(view),
    planCargoShips(view),
    planCorsair(view),
    planQuays(view),
    planHolds(view),
    planWeirs(view),
    planGroundChips(view),
  ]);
}
