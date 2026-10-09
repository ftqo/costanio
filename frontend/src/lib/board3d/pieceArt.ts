// How the board's pieces are named in the art, and how big they are drawn.
//
// Board3D and the hover ghost both read this, so a preview always matches the
// piece it previews.

/**
 * Pieces are modelled at true scale (a settlement is 0.47 across on a 5.2 hex),
 * which is nearly invisible at whole-board framing, so buildings are drawn
 * larger. Roads barely move: they already span their edge, and uniform scale
 * would stretch them over neighbouring tiles.
 */
export const PIECE_SCALE = {
  settlement: 2.0,
  // 29% over the settlement, judged at the board's camera. Size is a weak cue
  // (one piece varies 1.58x in projected area across the board, against 2.0x
  // between the two kinds), so this only widens the gap where it's cheap. The
  // ghost, the thumbnails and the board all read this table.
  city: 2.58,
  road: 1.15,
} as const;

/** The robber reads as a piece too, but it stands on a whole tile. */
export const ROBBER_SCALE = 1.5;

/**
 * The expansion pieces, drawn larger than true scale like PIECE_SCALE above.
 * Edge pieces (ships) take the road's factor; whole-hex pieces take the
 * robber's.
 */
export const MODULE_SCALE = {
  ship: 1.15,
  pirate: 1.5,
  knight: 2.0,
  // Sized off the city it encloses: 2.23 clears the city at 2.58 by 0.020 at
  // the tightest bearing (2.0 overlapped by 0.051). Measured per bearing by
  // dense face sampling, since the ring is far from circular (inner radius
  // 0.530 to 1.098). Walled cities sit 6.29 apart, so there is room.
  wall: 2.23,
  metro: 2.0,
  merchant: 1.5,
  barbarian: 2.0,
  /**
   * The Caravans camel: 1, because it was authored at drawn size, straddling a
   * road at the road's drawn size (belly at 0.660 against the road's drawn top
   * of 0.434, feet clear of its drawn half-width of 0.1438). Listed so the 1
   * reads as measured rather than forgotten.
   */
  camel: 1.0,
  /**
   * The Fishermen weir. Unlike every other entry it is not applied on top of a
   * `seat` call: the weir is driven into the seabed (at 1.4 its stakes reach
   * y = 0.035, 0.125 below the sea tile's 0.1596 top, and its floats straddle
   * the `Ocean_waves` crest at 0.217). `layers/fishermen.ts` places it at y = 0.
   */
  fishingGround: 1.4,
  /**
   * The Caravans waypost pair marking an unstarted spoke. 1, like the camel
   * that replaces it in the same edge slot, so the swap doesn't change size.
   */
  spoke: 1.0,
  /**
   * The Rivers bridge: the road's factor. It spans an edge, and it shares the
   * road's slot; `bridgeArt.test.ts` relies on the two being drawn at the same
   * factor, so the bridge stands out by its authored height and arch alone.
   */
  bridge: 1.15,
  /**
   * The Raiders rider, standing on a path: the road's 1.15. Its authored length
   * is 0.902, cut to fit a path. Not the knight's 2.0: a knight has its vertex
   * to itself, while a rider shares a path with roads, camels and wagons.
   */
  rider: 1.15,
  /**
   * The Raiders raider: a neutral figure on a hex (`Barbarian_*` in
   * barbarians.glb). Unrelated to `barbarian` above, the Knights fleet's
   * `Ship_barbarian` in ships.glb; both appear when Knights and Raiders mix.
   *
   * The art was judged at 1.4 (`BARBARIAN_SCALE` in
   * `tools/blender/render_barbarians.py`). At 1.7 one raider is 1.56 tall
   * against the settlement's 0.80 and the robber's 2.25, so it doesn't read as
   * tile decoration, and three still clear the chip by 1.186 against its 1.05
   * keep-clear. `barbarianArt.test.ts` holds both bounds. Its slate greys
   * (`Mat_Barbarian_tunic` 0.30, `_helm` 0.16) blend with ore; that is the
   * blend's palette to fix.
   */
  raider: 1.7,
  /**
   * The Wagons wagon, on a vertex a settlement may already occupy.
   *
   * The brief, judged at drawn sizes: about as long as the house is wide,
   * distinctly narrower, and just under its height, so it reads as a vehicle
   * parked at a building. At 1.65 it draws 0.909 long against the house's 0.94
   * width, 0.578 across and 0.743 tall (0.93 of the house's height); 1.0 hides
   * behind the house and 2.0 swallows it (`tools/blender/render_wagon.py`).
   * `wagonArt.test.ts` holds the ratios.
   *
   * `RING_RADIUS` in `layers/wagons.ts` is multiplied by this, since those
   * radii are derived from the wagon's authored envelope.
   */
  wagon: 1.65,
  /**
   * The barbarian warrior that stands on a path. Not `barbarian` above, which
   * is the Knights fleet's ship in ships.glb.
   *
   * 1.4 draws 1.29 tall: above a knight (1.10), well below the robber (2.25).
   * At 1.15 three helms merged into one smudge at playing distance.
   */
  pathBarbarian: 1.4,
  /**
   * The Explorers cargo ship: the road's factor, shared with `ship`. It spans a
   * sea edge (1.10 long, authored along +x), and an Islands game with Explorers
   * floats both, so different factors would read as different distances.
   */
  cargo: 1.15,
  /**
   * The corsair, this expansion's robber: the pirate's factor, like every
   * whole-hex piece. `vesselArt.test.ts` measures its chip clearance in
   * authored units; that's sufficient because the corsair only stands on
   * revealed sea hexes (`pirateHexLegal`), which carry no chip.
   */
  corsair: 1.5,
  /**
   * The harbour quay: the settlement's factor, pinned by `harborArt.test.ts`.
   *
   * The quay stands beside the building on its vertex, with its near edge
   * authored 0.5 out along +x, so at 2.0 it stands 1.0 from the vertex and
   * clears the largest shipped city (0.834 drawn) by more than 0.1 of visible
   * ground. The test reads `PIECE_SCALE.settlement`, so changing that re-checks
   * the clearance.
   */
  harbor: 2.0,
  /**
   * What rides in a hold or a basin: the settler, the crew, the fish haul and
   * the spice sack.
   *
   * Cargo is authored to one 0.34 by 0.18 rectangle with its floor 0.06 up,
   * which fits two hosts drawn at different sizes (ship 1.15, quay 2.0). Scaling
   * with the host would resize a settler as it was unloaded, so cargo uses the
   * tighter host's factor, the ship's.
   */
  cargoPiece: 1.15,
  /**
   * The mission marker, which nothing on the board draws (mission tracks are a
   * UI panel; see `planMarkers` in `layers/explorers.ts`).
   *
   * Kept because markers stack on a rival's track at their own 0.08 thickness,
   * so whatever draws a track should take pitch = 0.08 * this from here. The
   * settlement's 2.0, since at an authored 0.2 across it is the smallest piece
   * in the expansion.
   */
  missionMarker: 2.0,
  /**
   * The Explorers pirate lair token (`Lair_*` in lairs.glb), standing on the
   * goldfield's empty chip socket. Authored at the size it is drawn at, as the
   * camel is, so 1: it was sized live against the tile it stands on (1.8 wide,
   * its flag at 1.8), not against a number here.
   */
  lair: 1.0,
  /**
   * The crew figure that stands on a hex (`Boarder_*` in lairs.glb): three in a
   * rank storm a lair, one per seat on a spice farm. Authored at drawn size
   * (0.61 to the head, cutlass to 0.75, against a settlement's 0.40 and a
   * city's 0.78), so 1. Not `cargoPiece`, the small hold figure.
   */
  boarder: 1.0,
  /**
   * The camel's punt (`Raft_*` in camels.glb) on a pure sea path. Authored in
   * the camel's own frame, so it takes the camel's 1 and the two are drawn at
   * one placement.
   */
  raft: 1.0,
} as const;

/** Node-name prefix in pieces.glb for each piece kind. */
export const PIECE_PREFIX = {
  settlement: "Settlement_A",
  city: "City_A",
  road: "Road_A",
} as const;

/**
 * The turn that squares each piece to the board, in radians about Y.
 *
 * All zero: `tools/blender/anchors.py` AUTHORED_TURN cancels each family's
 * staging yaw at export, so doorways face +z (the viewer's side), the same
 * direction as the chips' pip rows, `TILE_ROTATION_Y` and the metropolis and
 * wall gates. `pieceFacing.test.ts` checks the shipped glb.
 *
 * Kept as a table so the ghost and the piece read facing from one place, and a
 * family that can't be squared at export has somewhere to go.
 */
export const PIECE_FACING = {
  // Exported square. See AUTHORED_TURN.
  settlement: 0,
  city: 0,
  // The bar is exported along +x and `edgeRotationY` owns which way it points.
  road: 0,
} as const;
