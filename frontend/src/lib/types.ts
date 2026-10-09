// Wire types mirroring the Go backend (server/api.go, game/views.go,
// engine/board/json.go). Hands/dev arrays are fixed-length int arrays.

export type Resource =
  | "wood"
  | "brick"
  | "sheep"
  | "wheat"
  | "ore"
  | "gold"
  | "sea"
  | "lake"
  | "none"
  | "fog"
  | "land"
  | "border"
  // Rivers' marsh: land that produces nothing and takes no number. A real
  // terrain on the wire (engine/board's `Swamp`), unlike the Caravans oasis,
  // so resource-keyed lookups handle it directly.
  | "swamp";

/** [_, wood, brick, sheep, wheat, ore]; index 0 unused. */
export type Hand = [number, number, number, number, number, number];
/** [knight, victory_point, road_building, year_of_plenty, monopoly] */
export type DevHand = [number, number, number, number, number];

export const RES_INDEX = { wood: 1, brick: 2, sheep: 3, wheat: 4, ore: 5 } as const;

/**
 * A single resource off the wire, as a Hand index (1..5), or 0 for none.
 *
 * A single board.Resource serializes as a string ("wood".."ore", "none"), while
 * Hand entries are numeric indices, and old logs carried the numeric form for
 * single resources too (lib/eventlog.ts's `resName` handles the same). Never
 * index a per-resource table with the raw field.
 */
export function resIndexOf(res: unknown): number {
  if (typeof res === "string") return (RES_INDEX as Record<string, number>)[res] ?? 0;
  if (typeof res === "number" && res >= 1 && res <= 5) return res;
  return 0;
}

// ---- coordinates ----
export interface Hex {
  q: number;
  r: number;
}
export interface Vertex {
  q: number;
  r: number;
  /**
   * 0 = N (top), 1 = S (bottom); a larger value is a module vertex.
   *
   * The Wagons trade hex's plaza sits at the hex centre and is addressed by the
   * hex's coordinate with a third side value. The engine's build rules refuse
   * any side past S, so a plaza is never buildable (engine/wagons/board.go).
   *
   * `vertexToWorld` (here and in board3d/coords) tests `=== 0` and treats
   * anything else as south, which is wrong for a plaza; `layers/wagons.ts`
   * positions plazas itself. A caller needing a real corner should use
   * foldEvent's guard, which rejects anything outside 0 and 1.
   */
  side: number;
}
export interface Edge {
  a: Vertex;
  b: Vertex;
}

/**
 * The server's clock policy, served rather than compiled in. Read these rather
 * than hard-coding a literal. `seat_budgets` on the view carries the actual
 * budget for the decision on the clock; this is the policy behind it.
 */
export interface TurnTimerPreset {
  label: string;
  sec: number;
}

export interface Timings {
  turn_timer_presets: TurnTimerPreset[];
  default_turn_sec: number;
  min_turn_sec: number;
  max_turn_sec: number;
  /** Grace past zero before the server acts, in ms. */
  buffer_ms: number;
  /** Decision kind -> full budget in ms, already clamped to this game's timer. */
  caps: Record<string, number>;
  /** The window a newly posted trade offer gets in this game, in ms. */
  offer_ms: number;
}

// ---- REST shapes ----
export interface GameConfig {
  players: number;
  target_vp: number;
  discard_limit: number;
  turn_timer_sec: number;
  ruleset: string;
  preset?: string;
  board?: Board; // custom inlined map (wins over preset/procedural)
  dice_mode?: "random" | "fair";
  board_mode?: "random" | "fair";
  turn_order?: "lobby" | "random";
  friendly_robber?: boolean;
  show_bank?: boolean;
  /**
   * Knights only: draw every seat's city-improvement levels on its rail card.
   * Default on. Display-only, like `show_bank`: the levels are in the view
   * either way.
   */
  show_improvements?: boolean;
  /**
   * Memory mode: the table does no bookkeeping for you. The bank supply is not
   * drawn, seat cards lose their VP total and counters row (keeping the award
   * chips), and event-log lines fade a few seconds after arriving. Default off;
   * ranked games lock it on.
   *
   * Display-only: every hidden number is still on the view, since the client
   * needs them to price trades and builds.
   */
  memory_mode?: boolean;
  modules?: Record<string, unknown>;
}

// KnightsOptions is the Knights module's slice of GameConfig.modules["cak"]. Mirrors
// engine/knights/Config; omitted/zero fields fall back to engine defaults.
export interface KnightsOptions {
  skip_first_barbarian_attack?: boolean;
  barbarian_distance?: number;
}

// IslandsOptions is the Islands module's slice of GameConfig.modules["islands"].
// Mirrors engine/islands/Config; omitted/zero fields fall back to engine
// defaults (island_vp 2, pirate true).
export interface IslandsOptions {
  island_vp?: number;
  pirate?: boolean;
  /**
   * Where the starting settlements may go: "auto" (the default) is the main
   * island when the map has one and any island on an archipelago; "any" is
   * any island. See lib/maps/mainIsland.ts.
   */
  start_island?: "auto" | "any";
}

export interface MapRow {
  id: string;
  name: string;
  board: Board;
  created_by: number;
  created_at: number;
}

export interface Game {
  id: string;
  status: string; // "lobby" | "active" | "finished"
  ruleset: string;
  config: GameConfig;
  /**
   * The table's link, minted at creation and kept for the table's life. Not
   * the privacy flag: a public table has one too, so a host can share a direct
   * link.
   *
   * A public table's code is disclosed to everybody. A private table's goes
   * only to its host and seated players, so absent means "not disclosed to
   * you". Going private rotates the code.
   */
  invite_code?: string;
  /**
   * Whether the table is listed in the browser and joinable without the code.
   * Read this, never `invite_code`, to ask whether a table is private.
   */
  public?: boolean;
  created_by: number;
  /**
   * A ranked-queue table. Optional only because a cached summary may predate
   * the field.
   *
   * Check it before offering a host power: the server refuses to reset a
   * ranked game (409 RANKED_NO_RESET).
   */
  ranked?: boolean;
  winner?: number;
  created_at: number;
  finished_at?: number;
}

export interface Seat {
  game_id: string;
  no: number;
  user_id: number;
  status: "active" | "auto" | "bot";
  user_name: string;
  is_guest: boolean;
  avatar?: string; // profile-picture URL, or absent (UI falls back to a color disc)
  color: string; // effective render hex (chosen or seat-order default)
  decoration?: string; // equipped name-decoration item id, or absent
  rating?: number; // per-ruleset display rating (Discord humans only; absent for bots/guests)
  provisional?: boolean; // rating still calibrating (absent when settled)
}

export interface ColorView {
  id: string;
  name: string;
  hex: string;
  free: boolean;
  available: boolean;
  /** Pips price, 0 for a color that cannot be bought (free, or supporter-only). */
  price: number;
}

export interface CosmeticItem {
  id: string;
  slot: string;
  name: string;
  price: number;
  supporter: boolean;
  booster: boolean;
  kofi: boolean;
  staff: boolean;
  gift: boolean;
  /**
   * A placeholder id with a price and no art (cosmetics/catalog.go). Optional
   * only so a client can outlive a server that predates the field; treat an
   * absent value as false.
   */
  reserved?: boolean;
  owned: boolean;
  equipped: boolean;
  locked: boolean;
}

export interface WalletEntry {
  amount: number;
  reason: string;
  at: number;
}

export interface Summary {
  game: Game;
  seats: Seat[];
  host_name: string; // creator's display name; the host may hold any seat or none (spectating)
  host_decoration?: string; // host's equipped name-decoration item id
  // Clock policy for this table. Present on a single game's summary, absent on
  // the browse list (identical in every row, so it is not repeated there).
  timings?: Timings;
}

/** GET /api/games/{id} response: the lobby summary plus, for active games, the
 * per-viewer live view, last-50 redacted log, and last-50 chat lines. */
export interface GameDetail extends Summary {
  view?: FullView;
  log?: { seq: number; type: string; data: unknown }[];
  chat?: { id: number; scope: string; from: string; user_id: number; msg: string }[];
}

export interface UserStats {
  ruleset: string;
  games: number;
  wins: number;
  // Games that finished with no winner (an agreed draw, or a claim against bots
  // with nobody ahead). A subset of `games`, disjoint from `wins`, so the win
  // rate stays wins/games.
  draws?: number;
  // Non-ranked, exactly-four-player games. A subset of `games`, disjoint from
  // the ranked counters but not their complement (casual games at other player
  // counts are in neither). Optional for older servers.
  casual_games?: number;
  casual_wins?: number;
  casual_draws?: number;
  elo: number;
  provisional?: boolean;
}

export interface Me {
  id: number;
  name: string;
  avatar: string;
  guest: boolean;
  stats: UserStats[] | null;
  online: boolean;
  game: string;
  /** Status of the seated `game`: "lobby" | "active" (empty when not seated). */
  game_status?: string;
  /** Live supporter status (Discord role / Ko-fi). Public. */
  supporter?: boolean;
  /** Pip balance. Self-only; present on /api/me, absent for guests. */
  pips?: number;
  /** Linked login providers (self only). */
  identities?: { provider: string; name: string }[];
}

export interface LeaderboardEntry {
  user_id: number;
  name: string;
  avatar: string; // profile-picture URL, or "" (UI falls back to a color disc)
  elo: number;
  games: number;
  wins: number;
  decoration: string;
  provisional?: boolean;
}

export interface Friend {
  id: number;
  name: string;
  avatar: string;
  online: boolean;
  game: string;
}

// ---- board JSON ----
export interface BoardTile {
  hex: Hex;
  res: Resource;
  num: number;
}
export interface Harbor {
  verts: Vertex[];
  ratio: number;
  res: Resource;
}
export interface Board {
  radius: number;
  tiles: BoardTile[];
  robber: Hex;
  harbors: Harbor[];
}

/**
 * What `POST /api/preview` serves: one dealt board, everything needed to draw
 * it, and the seed that dealt it.
 *
 * `config`, `board` and `ext` are the same envelope `costan-sim -dump-view`
 * writes and `board-shots.tsx` reads, so the preview draws through the game's
 * own renderer. `ext` carries the module board features (Rivers watercourse,
 * Raiders castle, Caravans oasis, Fishermen grounds).
 *
 * `seed` is a decimal string: it is a uint64, and a JSON number would round it
 * and reproduce a different board.
 */
export interface PreviewEnvelope {
  seed: string;
  ruleset: string;
  config: GameConfig;
  board: Board;
  ext: Record<string, unknown>;
}
/**
 * One problem the server found on a board. As with ErrFrame: render from `code`
 * (plus `params`) via mapIssueText in lib/errorCopy. `debug` is the server's
 * English reference wording and must not be shown to a player.
 */
export interface MapIssue {
  severity: "error" | "warning";
  code: string;
  params?: Record<string, unknown>;
  debug?: string;
  hexes: Hex[];
}

// ---- full per-viewer game state (game.FullView) ----
export interface PlayerView {
  seat: number;
  hand_count: number;
  // Cards this seat may hold without discarding on a 7, after every module
  // delta (each Knights city wall adds 2). Computed by the engine.
  discard_at?: number;
  hand?: Hand; // own seat only
  roads_left: number;
  settlements_left: number;
  cities_left: number;
  dev_count: number;
  dev_cards?: DevHand; // own seat only
  new_dev_cards?: DevHand; // own seat only
  knights_played: number;
  /**
   * This seat's longest continuous route, the number Longest Road compares.
   * Computed by the engine with its module hooks (island ship routes count,
   * an enemy knight breaks a route), so the card matches the awarded title.
   * Optional for older servers.
   */
  route_length?: number;
  /**
   * Public VP for an opponent, full VP (hidden dev-card VP included) for the
   * viewer's own seat. For a scoreboard only; use `public_vp` for any
   * cross-seat comparison.
   */
  vp: number;
  /**
   * What every other seat can see of this one: `PublicVPWithModules`, on every
   * row including the viewer's own (game/views.go). The public-standing rules
   * compare this (Master Merchant and Wedding target seats strictly above you,
   * Saboteur seats at or above). Optional for older servers; read it through
   * `publicVp()`.
   */
  public_vp?: number;
}

export interface BuildingView {
  v: Vertex;
  owner: number;
  city: boolean;
}
export interface RoadView {
  e: Edge;
  owner: number;
}

/** One movable ship and the sea edges it may move to (Islands). */
export interface ShipMoveTargets {
  from: Edge;
  to: Edge[];
}
/**
 * One movable (active, not freshly-activated) knight and the vertices it may
 * move to (Knights). `displace` is the subset of `to` occupied by a
 * strictly-weaker enemy knight (a displacement, not a plain move).
 */
export interface KnightMoveTargets {
  from: Vertex;
  to: Vertex[];
  displace?: Vertex[];
}

/**
 * One job an Explorers ship may do from where it stands. `job` is the module's
 * command name minus its `explorers_` prefix. `h` is the hex the job acts on,
 * absent for `found` (where the corner is the answer).
 */
export interface ExplorerShipAct {
  job: "found" | "land_crew" | "take_crew" | "load_haul";
  v: Vertex;
  h?: Hex;
}

/** One Explorers ship's offer: where it may go, and what it may do there. */
export interface ExplorerShipTargets {
  ship: number;
  from: Edge;
  /** Sea edges one movement point away with room to stop. */
  moves?: Edge[];
  /**
   * The jobs it may do from where it stands, each named: two jobs can be legal
   * at the same corner, and founding a settlement spends the ship and settler
   * while landing a crew spends neither.
   */
  acts?: ExplorerShipAct[];
  /** Movement points left this turn. */
  left: number;
}

/** Positions the current player may place a piece at right now (own view only). */
export interface LegalTargets {
  settlements?: Vertex[];
  cities?: Vertex[];
  roads?: Edge[];
  /** Vertices where a knight may be placed (Knights expansion). */
  knights?: Vertex[];
  /** The player's cities still eligible for a wall (Knights expansion). */
  walls?: Vertex[];
  /** Sea edges where a ship may be built / the free setup ship may go (Islands). */
  ships?: Edge[];
  /** Per-movable-ship move destinations (Islands). */
  ship_moves?: ShipMoveTargets[];
  /** Per-movable-knight move/displacement destinations (Knights). */
  knight_moves?: KnightMoveTargets[];
  /** Legal destinations for a pending robber (land) / pirate (sea) move. */
  robber_hexes?: Hex[];
  pirate_hexes?: Hex[];
  /** Knights expansion interactions. */
  knight_edge_chases?: { v: Vertex; barb: number }[];
  chase_robber_hexes?: Hex[];
  /** Sea hexes a knight on a sea intersection may chase the PIRATE to. */
  chase_pirate_hexes?: Hex[];
  deserter_placements?: Vertex[];
  knight_relocations?: Vertex[];
  /** Your own cities the barbarians may raze; pick one after a lost defense. */
  barbarian_downgrades?: Vertex[];
  /** Your cities free of a metropolis; pick one to receive a metropolis you just earned. */
  metropolis_cities?: Vertex[];
  /** Per-progress-card target positions, keyed by card id (merchant, bishop, ...). */
  progress_targets?: Record<string, ProgressTarget>;
  /** City-improvement track indices (0 Trade, 1 Politics, 2 Science) the player may improve now. */
  improvements?: number[];
  /**
   * Explorers: the intersections a harbour settlement may take. During the
   * module's first setup round, where a starting harbour settlement may go
   * (the only time it holds an empty vertex); in play, which of the seat's
   * coastal settlements may be upgraded.
   */
  harbours?: Vertex[];
  /**
   * Explorers: per movable ship, where one movement point reaches and what it
   * may work from where it stands. One step only, because a discovery ends a
   * ship's movement.
   */
  explorer_ships?: ExplorerShipTargets[];
  /**
   * Caravans: the placements a camel may take.
   *
   * Present only for the seat that can act: the seat on the clock while bidding
   * is open (a bid may name its placement, which is how to join a coalition),
   * and the placer once the round has closed.
   *
   * Ordered by caravan, then along the chain; do not re-sort. A camel is
   * identified by the (caravan, edge) pair, since one edge can extend two
   * caravan fronts.
   */
  camel_paths?: CamelPath[];
  /**
   * Rivers: the empty bridge sites this seat's network reaches, with
   * connection, occupancy and the 3-bridge supply already applied. A subset of
   * `ext.rivers.sites`, which lists every crossing on the board and is not a
   * set of legal targets.
   */
  bridges?: Edge[];
  /**
   * Wagons: the intersections this seat's wagon may move to right now. Only
   * paths it can pay for in full, movement points and toll both (an unpayable
   * toll makes a path illegal).
   *
   * A plaza vertex has a `side` past the two corner sides: a real stopping
   * point, not buildable. See WagonsExt.
   */
  wagon_steps?: Vertex[];
  /**
   * Wagons: where a barbarian this seat owes a move for may be placed. Present
   * only while one is owed (after a 7, a played Knight, or a drive-off that
   * carried), and then it is the only legal action.
   */
  barbarian_edges?: Edge[];
}

/** One placement a pending camel may take (Caravans). */
export interface CamelPath {
  /**
   * Which caravan this extends: 0 to 2 at one oasis, up to 5 or 8 at the
   * larger tables' two or three. Caravan i leaves from `oases[floor(i / 3)]`.
   */
  caravan: number;
  e: Edge;
}

/** Board positions a single progress card may target (fields are card-specific). */
export interface ProgressTarget {
  hexes?: Hex[];
  vertices?: Vertex[];
  edges?: Edge[];
  moves?: ShipMoveTargets[];
}

export type TradeExtra =
  | number[]
  | { commodities?: number[]; coins?: number; gold?: number; wagon_gold?: number };

export interface ActiveOffer {
  by: number;
  give: Hand;
  want: Hand;
  give_com?: TradeExtra; // Knights commodities offered
  want_com?: TradeExtra; // Knights commodities wanted
  accepted?: number[];
  declined?: number[];
  counters?: CounterOffer[];
}

// DrawOffer is the open offer to end the game in a draw. Every other seat has
// to accept it; a single decline ends it, and so does the end of the turn.
export interface DrawOffer {
  by: number;
  accepted?: number[];
}

// CounterOffer is a non-active player's alternative terms, stated from their
// perspective: they give `give` and want `want` from the offerer.
export interface CounterOffer {
  by: number;
  give: Hand;
  want: Hand;
  give_com?: TradeExtra;
  want_com?: TradeExtra;
}

export interface FullView {
  seq: number;
  viewer: number; // seat, or -1 spectator
  config: GameConfig;
  phase: "setup" | "play" | "finished";
  cur: number; // current player seat
  setup_round?: number;
  need_road?: boolean;
  rolled?: boolean;
  robber_pending?: boolean;
  pending_discards?: Record<number, number>;
  board: Board;
  bank: Hand;
  players: PlayerView[];
  buildings: BuildingView[];
  roads: RoadView[];
  ext?: Record<string, unknown>;
  dev_deck_count: number;
  played_dev?: boolean;
  free_roads?: number;
  active_offer?: ActiveOffer;
  longest_road: number;
  largest_army: number;
  // The winning seat, or -1. A finished game can carry -1 too (a draw).
  winner: number;
  draw_offer?: DrawOffer;
  // The game's length in turns, and the length a draw offer or a claim against
  // bots needs, both from the server.
  turns_completed?: number;
  draw_min_turns?: number;
  /**
   * The highest public score the friendly-robber shield covers (the ruleset's
   * starting score), present only where the server applies the shield. Read it
   * through lib/robber friendlyShieldMaxVP, never the config switch.
   */
  friendly_robber_max_vp?: number;
  // Every seat but this viewer's is a bot, which allows ending the game
  // without consent.
  bots_only?: boolean;
  legal?: LegalTargets; // current player's placeable spots (own view only)
  bank_ratios?: number[]; // viewer's maritime rate per resource (idx 1..5); absent for spectators
  // Viewer's maritime rate for each non-resource good, keyed by wire name
  // ("cloth" | "paper" | "coin"). Separate from bank_ratios because the rule
  // differs: a generic 3:1 harbour lowers a commodity's rate, a 2:1 resource
  // harbour never does. Absent in the base game and for spectators.
  good_ratios?: Record<string, number>;
  // What the maritime trade command charges for each of those goods, which
  // can differ from good_ratios (a Trade-3 player's cloth is worth 2 at the
  // Trading House, but the maritime lane takes four). Display a rate from the
  // field above; price a staged basket with this one.
  good_maritime_ratios?: Record<string, number>;
  offer_deadline_ms?: number; // open table offer's remaining lifetime at emission; absent when no offer stands
  // The open draw offer's remaining lifetime. An unanswered offer is
  // withdrawn (a table with no turn timer has nothing else to clear it).
  draw_deadline_ms?: number;
  // Remaining budget (ms at emission) per seat on the clock, keyed by seat.
  // Several entries during simultaneous phases (discard-on-7); absent when no
  // timer is configured.
  seat_deadlines?: Record<number, number>;
  // Full budget (ms) of each on-the-clock seat's current decision, keyed like
  // seat_deadlines. The timer bar scales against this rather than inferring a
  // peak from remaining values, which tick up on a new decision or the
  // inactivity floor. Absent when no timer is configured.
  seat_budgets?: Record<number, number>;
  // This game's clock policy (caps, trade window, turn-timer bounds). Constant
  // for the game, but on every view because a reconnecting client gets only a
  // full view.
  timings?: Timings;
  // Display name per seat, on every view so spectators of a private game (who
  // cannot read the /api/games seat list) still see real names.
  seat_names?: Record<number, string>;
  /**
   * The equipped robber skin of the seat that last moved the robber, or absent
   * for the stock art. The robber belongs to the table, so it wears the skin
   * of whoever last moved it.
   */
  robber_skin?: string;
  /**
   * Each seat's equipped piece set, keyed by seat; absent for stock pieces.
   * Per seat because every client draws every seat's buildings.
   */
  seat_pieces?: Record<number, string>;
}

// ---- post-game scoreboard + rematch (game.Scoreboard / postgame frame) ----

/**
 * Per-source victory points for one seat. Every field is a VP figure except
 * `cities`, which the server stores as a count (2 VP each). Read through
 * `vpSources` rather than summing by hand.
 */
export interface VPBreakdown {
  settlements: number;
  cities: number;
  longest_road: number;
  largest_army: number;
  dev_vp: number;
  island_vp: number;
  metropolis: number;
  defender: number;
  merchant: number;
  extra_cak: number;
  caravan: number;
  /**
   * 2 while this seat holds the Harbormaster card, else 0. Public points.
   * Optional because match records saved before the field omit it; read it
   * through `vpSources`, which supplies the 0.
   */
  harbormaster?: number;
  /**
   * Rivers: the wealth tiles' net, +1 for the Wealthiest Settler and -2 for a
   * Poorest Settler (so it can be negative). Optional, as `harbormaster`.
   */
  wealth?: number;
  /**
   * Module points, optional as `harbormaster`. Raiders: `prisoners` is what the
   * prisoners score and `conquered` is negative (points conquered buildings
   * no longer score). Wagons: one per delivered load, and one for level five.
   * Explorers: the second point of each harbour settlement, and the missions.
   */
  prisoners?: number;
  conquered?: number;
  delivered?: number;
  wagon_level?: number;
  explorer_harbours?: number;
  missions?: number;
}

export interface KnightsStatLine {
  knights_total: number;
  knights_active: number;
  knight_levels: [number, number, number];
  metropolis: number;
  improve: [number, number, number];
  walls: number;
  commodities_produced: number;
  progress_played: number;
  barbarian_defenses_won: number;
  cities_lost_to_barbarians: number;
  defender_vp: number;
  merchant_vp: number;
  extra_vp: number;
}

export interface IslandsStatLine {
  island_vp: number;
  ships: number;
  gold_gained: number;
}

export interface FishStatLine {
  caught: [number, number, number];
  value: number;
  spent: number;
  has_boot: boolean;
}

export interface CaravanStatLine {
  camels_placed: number;
  caravan_vp: number;
  route_bonus: number;
  votes_cast: number;
}

export interface PlayerStat {
  seat: number;
  vp: number;
  /** Absent on match records saved before the breakdown shipped. */
  vp_breakdown?: VPBreakdown;
  settlements: number;
  cities: number;
  roads: number;
  knights: number;
  dev_cards: number;
  longest_road: number;
  has_longest_road: boolean;
  has_largest_army: boolean;
  produced: number;
  expected: number;
  robber_loss: number;
  stolen: number;
  steals: number;
  bank_trades: number;
  player_trades: number;
  luck_rel: number;
  islands?: IslandsStatLine;
  cak?: KnightsStatLine;
  fish?: FishStatLine;
  caravans?: CaravanStatLine;
}

export interface RematchState {
  want: number; // players who've voted for a rematch
  eligible: number; // players still on the post-game screen
  next?: string; // new game id once the host starts the rematch
  next_invite?: string; // new lobby's invite code (private games), so spectators can follow
}

/** A non-seated watcher of a game. */
export interface SpectatorInfo {
  user_id: number;
  name: string;
}

export interface Postgame {
  scoreboard?: PlayerStat[];
  winner?: number;
  rematch: RematchState;
  rolls?: Record<number, number>;
  turns?: number;
  /**
   * The standings at every turn boundary: one row per turn, one column per
   * seat, folded by the server (game/scoreboard.go). Missing from match
   * records saved before the field, so the chart must handle its absence.
   */
  vp_track?: number[][];
  board?: FullView;
}

// ---- WebSocket frames ----
export interface SubFrame {
  t: "sub";
  game: string;
  since?: number;
  invite?: string;
  id?: string;
}
export interface CmdFrame {
  t: "cmd";
  id?: string;
  game: string;
  cmd: { type: string; data?: unknown };
}
export interface ChatOut {
  t: "chat";
  scope: string; // "lobby" | "game:<id>"
  msg: string;
}
export interface RematchOut {
  t: "rematch";
  game: string;
}
export interface ReportOut {
  t: "report";
  chat_id: number;
}
export interface UnsubFrame {
  t: "unsub";
}
/**
 * Liveness probe, answered by a `pong`. A half-open socket still reports
 * `readyState === OPEN` and accepts writes, and protocol-level pings never
 * reach script, so the client reads silence here as a dead link. See lib/ws's
 * heartbeat.
 */
export interface PingOut {
  t: "ping";
}
export type ClientFrame =
  | SubFrame
  | UnsubFrame
  | CmdFrame
  | ChatOut
  | RematchOut
  | ReportOut
  | PingOut;

export interface StateFrame {
  t: "state";
  game: string;
  seq: number;
  full: FullView;
}
export interface EventFrame {
  t: "ev";
  game: string;
  seq: number;
  ev: { seq: number; type: string; data: unknown };
}
/**
 * A refusal. Render from `code` (plus `params`); see lib/errorCopy.
 *
 * `debug` is the server's English reference wording, a developer aid for
 * reading network dumps. Never render it: it is not localized.
 */
export interface ErrFrame {
  t: "err";
  ref: string;
  code: string;
  params?: Record<string, unknown>;
  debug?: string;
}
export interface LobbyFrame {
  t: "lobby";
  game: string;
  summary?: Summary;
  started?: boolean;
  closed?: boolean; // host left / table abandoned; clients should bounce out
  next?: string; // host reset the game: id of the fresh lobby to redirect into
  next_invite?: string; // the fresh lobby's invite (private tables), so spectators can follow
}
export interface ChatIn {
  t: "chat";
  id?: number; // chat row id; present on live frames
  scope: string;
  from: string;
  user_id: number;
  msg: string;
}
export interface PostgameFrame {
  t: "postgame";
  game: string;
  scoreboard?: PlayerStat[];
  winner?: number;
  rematch: RematchState;
  rolls?: Record<number, number>;
  turns?: number;
  /**
   * The standings at every turn boundary: one row per turn, one column per
   * seat, folded by the server (game/scoreboard.go). Missing from match
   * records saved before the field, so the chart must handle its absence.
   */
  vp_track?: number[][];
  board?: FullView;
}
export interface ResyncFrame {
  t: "resync";
  game: string;
}
/** The answer to a `ping`. Carries nothing; its arrival is the message. */
export interface PongFrame {
  t: "pong";
}
export interface PresenceFrame {
  t: "presence";
  game: string;
  spectators: SpectatorInfo[];
}
export interface RankedMatchFoundFrame {
  t: "ranked_match_found";
  game: string;
}
/** A user's role-derived status (supporter + staff/Ko-fi perks). Mirrors the
 * backend cosmetics.SupporterView. */
export interface SupporterView {
  active: boolean;
  boosting: boolean;
  kofi: boolean;
  staff: boolean;
  since: number;
  tier?: string;
  badge?: string;
}
/** Pushed to a user's own connections when their role-derived status changes,
 * so it updates without a re-login (notably inside the Activity). */
export interface SupporterUpdatedFrame {
  t: "supporter_updated";
  supporter: SupporterView;
}
export type ServerFrame =
  | StateFrame
  | EventFrame
  | ErrFrame
  | LobbyFrame
  | ChatIn
  | PostgameFrame
  | ResyncFrame
  | PongFrame
  | PresenceFrame
  | RankedMatchFoundFrame
  | SupporterUpdatedFrame;

/**
 * An HTTP error body. As with ErrFrame, render from `code` and `params`;
 * `debug` must not be shown to a player.
 */
export interface ApiError {
  code: string;
  params?: Record<string, unknown>;
  debug?: string;
}

// ---- module ext views (game/views.go ext namespaces) ----
export interface IslandsExt {
  ships: { e: Edge; owner: number }[];
  ships_left: number[];
  pirate?: Hex;
  pending_gold?: Record<number, number>;
  island_vp?: Record<number, number>;
  moved_ship: boolean;
}

export interface KnightsPlayer {
  commodity_count: number;
  commodities?: [number, number, number]; // cloth, paper, coin (own seat only)
  improve: [number, number, number]; // Trade, Politics, Science levels
  progress_count: number;
  progress?: string[]; // own seat only
  metropolis: [boolean, boolean, boolean];
  metropolis_at: [Vertex, Vertex, Vertex]; // vertex of each track's metropolis (meaningful when metropolis[t])
  walls: number;
  defender_vp: number;
  merchant_vp: number;
  extra_vp: number;
}
export interface KnightsExt {
  players: KnightsPlayer[];
  // `freshly_activated` is the engine's per-knight "activated this turn" flag,
  // surfaced on KnightView; consumers gate Move/Chase-robber on `!freshly_activated`.
  knights: {
    v: Vertex;
    owner: number;
    level: number;
    active: boolean;
    freshly_activated: boolean;
    // The promotion cap is per knight: this knight has already gone up a
    // level this turn.
    promoted_this_turn: boolean;
  }[];
  // Commodities left in the shared supply, in engine order (cloth, paper,
  // coin). Like FullView.bank, a stack can run out. Present from the first
  // frame of a Knights game.
  commodity_supply: [number, number, number];
  barbarians: number; // steps advanced toward shore (track length 7)
  attacks: number;
  merchant?: Hex;
  walled?: Vertex[]; // city vertices carrying a wall
  decks: [number, number, number];
  pending_give?: Record<number, number>;
  // Seat -> the resource the Commercial Harbor player offered it. A single
  // board.Resource, so a name on the wire ("brick"); read it with resIndexOf.
  harbor_give?: Record<number, string | number>;
  aqueduct?: number[]; // seats owed a free Aqueduct bank resource
  spy?: { victim: number; cards: string[] }; // thief-only: victim's progress hand to choose from
  master_merchant?: { victim: number }; // thief-only: victim whose combined hand is revealed (resources via players[victim].hand, commodities via ext.cak.players[victim].commodities)
  deserter_victim: number; // seat that must surrender a knight (-1 = none)
  deserter_taker: number; // seat that owes a replacement knight (-1 = none)
  deserter_level?: number; // strength of the owed replacement
  defender_draws?: number[]; // tied-defender draw queue; front seat draws next
  barbarian_downgrade?: number[]; // seats that must each pick a city for the barbarians to raze
  reloc_player: number; // seat that must relocate a displaced knight (-1 = none)
  // No reloc_from: the origin vertex is not published. legal.knight_relocations
  // already names the legal destinations and the board highlights them.
  // A metropolis earned but not yet placed: its holder still has to name the city.
  // Absent when nothing is pending. `prev` is the seat it is taken from (-1 when
  // the track was unclaimed).
  metropolis_pick?: { player: number; track: number; prev: number };
}

/**
 * Fishermen (engine/scenarios/fishermen.go), as one viewer sees it. Every field is
 * optional so a client degrades against an older server (e.g. a missing `mix`
 * shows an empty holding).
 */
export interface FishExt {
  /**
   * Fish tile count per seat, public like `hand_count`. The count follows from
   * public facts (roll, grounds, buildings). The per-seat value is not
   * published, since value plus count would identify the tiles. See
   * engine/scenarios/fishermen.go, FishExt.Tiles.
   */
  tiles?: number[];
  /**
   * The viewer's own tiles: how many 1-, 2- and 3-fish tiles they hold.
   * Withheld from other seats and spectators. Fish make no change, so a player
   * holding one 3-fish tile pays all three for the 2-fish spend; the spend
   * panel needs the mix to say so.
   */
  mix?: [number, number, number];
  /**
   * Every seat's tiles, seat-indexed, present only in a revealed replay of a
   * finished game (game.NewRevealedReplayView via engine.RevealedViewable).
   * Absent from every live view, spectators included.
   */
  mixes?: [number, number, number][];
  /** The seat holding the old boot, or -1 (engine.NoPlayer) when nobody does. */
  boot_holder?: number;
  /**
   * The six fishing grounds: the coastal intersections each feeds, and the sea
   * hex each is the notch of. The engine always sends `hex`; absence means an
   * older server, and the board then draws nothing for that ground.
   */
  grounds?: { v: Vertex[]; number: number; hex?: Hex }[];
  /**
   * The numbers a lake pays on, ascending. Sent here because the flooded
   * desert produces on four numbers and `BoardTile.num` holds one; keeps the
   * client off a copy of the engine's `scenarios.LakeNumbers`. An older server omits
   * it and the lake draws with no chips.
   *
   * This is the first lake's set. From five seats a board has more lakes, the
   * others paying on 4 and 10 only, so read `lakes` and fall back to this only
   * when `lakes` is absent (games recorded before derivation 13).
   */
  lake_numbers?: number[];
  /** Every lake and the numbers it pays on (engine/scenarios.fishLake). */
  lakes?: { hex: Hex; numbers: number[] }[];
}

export function fishExt(v: FullView): FishExt | undefined {
  return v.ext?.fishermen as FishExt | undefined;
}

/**
 * The Islands module state, or the state it starts in if the module has not
 * yet folded an event.
 *
 * `s.Ext["islands"]` is created by the module's first event (engine/islands
 * `ext`), so there is no `ext.islands` during board generation and the first
 * player's opening placement. Absent state in an Islands ruleset means the
 * fresh one (no ships, full supply, no pirate), matching the engine's
 * `freshExt`. Cached per view so callers see one object identity.
 */
export function islandsExt(v: FullView): IslandsExt | undefined {
  const x = v.ext?.islands as IslandsExt | undefined;
  if (x || !(v.config?.ruleset ?? "").split("+").includes("islands")) return x;
  let fresh = FRESH_ISLANDS.get(v);
  if (!fresh) {
    fresh = {
      ships: [],
      ships_left: (v.players ?? []).map(() => ISLANDS_MAX_SHIPS),
      moved_ship: false,
    };
    FRESH_ISLANDS.set(v, fresh);
  }
  return fresh;
}
const FRESH_ISLANDS = new WeakMap<FullView, IslandsExt>();
/** Each seat's ship supply at the start of an Islands game (engine/islands MaxShips). */
export const ISLANDS_MAX_SHIPS = 15;
export function knightsExt(v: FullView): KnightsExt | undefined {
  return v.ext?.cak as KnightsExt | undefined;
}

/**
 * A seat's public victory points, the number every cross-seat rule compares.
 * Falls back to `vp` without `public_vp`, which is exact for an opponent and
 * only too high for the viewer's own seat.
 */
export function publicVp(p: PlayerView): number {
  return p.public_vp ?? p.vp;
}

/** The default barbarian track length, when the ruleset does not set one. */
export const BARB_DIST_DEFAULT = 7;

/**
 * How many steps the barbarians take to reach the coast. Mirrors the engine's
 * clamp: a configured distance applies only within [4,12], otherwise the
 * default. Shared so both places that draw the track agree.
 */
export function barbDist(v: FullView): number {
  const cfg = (v.config.modules?.cak as { barbarian_distance?: number } | undefined)
    ?.barbarian_distance;
  return cfg !== undefined && cfg >= 4 && cfg <= 12 ? cfg : BARB_DIST_DEFAULT;
}

/**
 * Whether the fleet's next landfall is the free one (engine/knights: `Skipped`):
 * the table's skip-first-invasion option (in `config.modules.cak`) and no
 * landfall yet in `ext.cak.attacks`, which counts the skipped one too.
 *
 * `ext.cak` is absent until the module's first event (the event die on the
 * first roll), when no attack can have happened, so missing reads as zero
 * attacks.
 */
export function barbFirstIgnored(v: FullView): boolean {
  const skip = (v.config.modules?.cak as KnightsOptions | undefined)?.skip_first_barbarian_attack;
  return !!skip && (knightsExt(v)?.attacks ?? 0) === 0;
}

/**
 * Caravans (engine/scenarios/caravans.go), as one viewer sees it. Every field is
 * optional so a client degrades against an older server; the fields where
 * absence carries meaning are noted below.
 */
export interface CaravansExt {
  /**
   * Every camel on the board, grouped by caravan and, within one, in the order
   * the chain grows out of the oasis. Do not sort: the order defines the
   * caravan (each scoring junction is the vertex shared by a consecutive pair)
   * and the direction the camel art faces, since an Edge is unordered.
   * `planCamels` walks the chain.
   */
  camels?: CamelPath[];
  /** Camels still in the shared supply. */
  camels_left?: number;
  /** The size of the supply, so "9 of 22 placed" needs no hardcoded constant. */
  camel_supply?: number;
  /**
   * The three spokes: where each caravan leaves the oasis, before it has any
   * camels. A caravan whose oasis corner has no outward land edge is omitted
   * rather than given the zero edge, which is a real edge at the origin.
   */
  caravans?: { caravan: number; arrow: Edge; corner: Vertex }[];
  /**
   * Every edge carrying a camel, flat. Redundant with `camels`; the set a road
   * renderer tests for the doubled-route rule.
   */
  occupied?: Edge[];
  /** The (first) oasis hex. Absent, not zeroed, when this board has no oasis. */
  oasis?: Hex;
  /**
   * Every oasis, the first included: two at 5 and 6 seats, three at 7 to 10.
   * Caravan i leaves from `oases[floor(i / 3)]`. Absent from an older server,
   * where `oasis` is the only one.
   */
  oases?: Hex[];

  // ---- the camel vote, present only while one is open ----
  /** True while a vote is open. Absent (not false) when none is. */
  voting?: boolean;
  /** The seat whose turn ended and opened the vote; ties and no-bids fall to it. */
  finisher?: number;
  /** The seat that won the vote, or -1 while bidding is still open. */
  placer?: number;
  /**
   * Which seats have answered, in seat order. Bidding is sequential, so this
   * also says whose go it is: the first seat after `finisher` not in here.
   * `camelOnClock` in lib/caravans is the only place that walk is written.
   */
  bidded?: number[];
  /**
   * Every bid cast so far, public throughout the round: a later bidder answers
   * knowing the tally, which is what makes a coalition (see `reason`) possible.
   *
   * `cards` counts votes against `bid_resources`, in that order. `path` is the
   * placement this seat wants; a bid naming none joins no coalition.
   */
  bids?: CamelBid[];
  /**
   * The two resources this ruleset bids in, as names ("sheep", "wheat"); read
   * through `bidResources` to get Hand indices. Ruleset-dependent: wool and
   * grain normally, brick and lumber alongside Knights. An older server omits
   * it, meaning wool and grain.
   */
  bid_resources?: (number | string)[];
  /**
   * Why `placer` is that seat: "majority" | "coalition" | "tie" | "nobody".
   * Present with `bids` once the round has closed. `placer` alone cannot tell
   * a win from a tie or an empty round (both fall to the finisher). Computed by
   * the same `pickPlacer` that stamps the event log's `reason`.
   *
   * `coalition` gives nobody a pick: two or more bidders naming the same path
   * with a combined majority have chosen, the engine places the camel in the
   * same batch, and `placer` stays -1.
   */
  reason?: string;
}

/**
 * One bid in a camel vote, as the view and `tab_camel_bid` both carry it.
 * `cards` is a pair of vote counts against `CaravansExt.bid_resources`, not a
 * fixed wool/grain pair. Older logs carry `{wool, grain}`; `bidVotes` in
 * lib/caravans reads both.
 */
export interface CamelBid {
  player: number;
  cards?: number[];
  path?: CamelPath;
  /** Pre-`cards` logs only. Never written; read so an old replay still renders. */
  wool?: number;
  /** Pre-`cards` logs only. See `wool`. */
  grain?: number;
}

export function caravansExt(v: FullView): CaravansExt | undefined {
  return v.ext?.caravans as CaravansExt | undefined;
}

/**
 * Explorers (engine/explorers), as one viewer sees it.
 *
 * Nothing here is per-seat secret. The unexplored pool is hidden from
 * everyone: clients get `fog`, the board arrives masked (the MaskBoard hook),
 * and the layout is redacted from `board_generated`.
 *
 * Every field is optional so a client degrades against an older server.
 */
export interface ExplorersExt {
  /** The home island's land hexes, and the ring of sea around them. */
  home?: Hex[];
  waters?: Hex[];
  /** The Council hex, and its two opposite berths. A ship docks at either. */
  council?: Hex;
  anchors?: Vertex[];
  /**
   * Every hex nobody has revealed. Derivable from the masked board, but served
   * so the client need not infer it from a resource name.
   */
  fog?: Hex[];
  /** Every hex somebody has revealed, and what it turned out to be. */
  revealed?: ExplorersHex[];
  harbours?: ExplorersHarbour[];
  ships?: ExplorersShip[];
  seats?: ExplorersSeat[];
  /** Shoals carrying a fish haul, and how many hauls the supply still holds. */
  hauls?: Hex[];
  hauls_left?: number;
  /**
   * The pirate ship, absent while none is on the board. `pirate_owner` is whose
   * it is (public: tribute is owed only to an opponent's ship, and the piece is
   * seat-tinted). `pirate_by` is who owes an activation now, usually a
   * different seat.
   */
  pirate?: Hex;
  pirate_owner?: number;
  pirate_by?: number;
  /** Who holds each mission track's bonus tile, or -1. */
  leaders?: number[];
  /** How many number chits each region's face-down stack still holds. */
  chits_left?: number[];
  /** Whether the active turn has walked through the one-way Movement door. */
  movement?: boolean;
  fish_rolled?: boolean;
  /** Which of the three setup rounds is running: harbour, settlement, start. */
  round?: number;
}

/** What a revealed pool hex turned out to be. `kind` is ExplorersKind. */
export interface ExplorersHex {
  h: Hex;
  region: number;
  kind: number;
  /** The die face this shoal answers to, 1-3 north and 4-6 south. */
  shoal?: number;
  /** Which spice village this farm holds; see EXPLORERS_VILLAGE. */
  village?: number;
  /** A gold field whose pirate lair has fallen. */
  captured?: boolean;
  /** Crews standing on an uncaptured lair, by seat. */
  crews?: number[];
  /** Which seats have landed their one crew on this farm. */
  farmers?: boolean[];
}

export interface ExplorersHarbour {
  v: Vertex;
  owner: number;
  /** What its basin holds: one large piece, or two small ones. */
  basin: ExplorersCargo;
}

export interface ExplorersShip {
  id: number;
  owner: number;
  e: Edge;
  hold: ExplorersCargo;
  /**
   * The end of `e` the ship points at: the one it arrived through. Not a rule
   * (an edge is unordered), but the art has a bow. Absent for a ship that has
   * never moved.
   */
  bow?: Vertex;
  /** Movement points left this turn. Zero once it has found something. */
  left: number;
  moved?: boolean;
  sped?: boolean;
  done?: boolean;
  /** Already rolled at the pirate this turn: not battle-ready again. */
  fought?: boolean;
}

/** A hold or a basin: one large piece (settler, haul) or two small (crew, sack). */
export interface ExplorersCargo {
  settler?: number;
  haul?: number;
  crew?: number;
  spice?: number;
}

export interface ExplorersSeat {
  gold: number;
  ships_left: number;
  settlers_left: number;
  crews_left: number;
  harbours_left: number;
  /** Position on each mission track, 0 (the start space) through 7. */
  track: number[];
  /** villages[kind][region]: the crew this seat has landed on that copy. */
  villages: boolean[][];
  gold_buys: number;
  fast_gold: number;
  /** Track positions plus bonus tiles, already summed by the server. */
  mission_vp: number;
}

/** ExplorersHex.kind, matching engine/explorers.Special. */
export const EXPLORERS_KIND = {
  none: 0,
  /** A gold field, revealed under a face-down pirate lair. */
  gold: 1,
  /** A fish shoal: water, carrying one of the six die faces. */
  shoal: 2,
  /** A spice farm: land, one sack per player, closed until you crew it. */
  spice: 3,
} as const;

/** ExplorersHex.village, matching engine/explorers.Village. */
export const EXPLORERS_VILLAGE = {
  swift: 0,
  pirate: 1,
  gold: 2,
} as const;

/** Victory points by track position, S then spaces 1 to 7. */
export const EXPLORERS_TRACK_VP = [0, 1, 1, 2, 2, 2, 3, 3] as const;

export function explorersExt(v: FullView): ExplorersExt | undefined {
  return v.ext?.explorers as ExplorersExt | undefined;
}

/** The seat's Explorers row, or undefined off an Explorers board. */
export function explorersSeat(v: FullView, seat: number): ExplorersSeat | undefined {
  return explorersExt(v)?.seats?.[seat];
}

/**
 * Harbormaster (engine/harbormaster), as one viewer sees it.
 *
 * All public: the holder and harbour points follow from the board and its
 * buildings, like Longest Road. Present from the first frame (the module seeds
 * zeroes in `InitExt`), so the counter does not appear mid-setup. Ask
 * `gameCaps().hasHarbormaster`, not this object, whether the module is in
 * play.
 *
 * Every field is optional so a client degrades against an older server.
 */
export interface HarbormasterExt {
  /**
   * The seat holding the Harbormaster card, or -1 (engine.NoPlayer). Absent
   * only from an older server; treat as nobody.
   */
  holder?: number;
  /**
   * Every seat's harbour points, seat-indexed: 1 per settlement and 2 per city
   * on a harbour vertex, nothing else (including a building whose harbour a
   * conquest made unusable). Re-derived by the engine every batch.
   */
  points?: number[];
  /**
   * The harbour points a seat needs before the card enters play, so the client
   * can draw "2 / 3" without its own constant. Currently 3 everywhere.
   */
  threshold?: number;
}

export function harbormasterExt(v: FullView): HarbormasterExt | undefined {
  return v.ext?.harbormaster as HarbormasterExt | undefined;
}

/**
 * One watercourse, as `engine/rivers`' `RiverView` sends it.
 *
 * Carries edges rather than tile names because each hex's channel is a rules
 * fact: it comes from the derived chain, joins neighbouring hexes, and decides
 * where bridges stand. Which file draws it, and how it is rotated, is art that
 * only `lib/board3d/layers/rivers.ts` knows.
 *
 * `in[i]` and `out[i]` are `hexes[i]`'s two channel edges: the seam with the
 * previous hex and with the next, except at the estuary, where `out` is the
 * coastal outlet. The pair is opposite (straight) or two apart (bend); a 60
 * degree hairpin is never produced.
 *
 * At the source `in[0] === out[0]`: a headwater hex has one mouth, the seam
 * with `hexes[1]`.
 */
export interface River {
  /**
   * The chain h1..hn, downstream: h1 is the headwater in the mountains and hn
   * is the swamp at the sea.
   */
  hexes: Hex[];
  /** The index in `hexes` of the swamp at the mouth: always `hexes.length - 1`. */
  mouth: number;
  in: Edge[];
  out: Edge[];
  /**
   * Which channel each hex draws, parallel to `hexes`. The engine's answer; do
   * not recompute it from `in` and `out`. Fifteen ids: nine two-mouth channels
   * named for their sorted compass pair, six headwaters named
   * `src_<direction>`. `""` draws plain terrain. An older server omits it and
   * no river tiles are drawn.
   */
  shapes?: RiverShape[];
  /**
   * This river's bridge sites: the n-1 seams plus the estuary's one coastal
   * outlet. `n` per river, which is the rule's count.
   */
  sites: Edge[];
  /**
   * Which authored meander of its shape each hex draws, parallel to `hexes`.
   * Only the east-west straight has more than one, so other entries are 0.
   * Drawn from a reserved public stream at board time and logged, so the
   * fairness audit reproduces it. Absent means meander 0 everywhere.
   */
  variants?: number[];
}

/**
 * The channel a river hex draws. `""` is a pair no tile has.
 *
 * The nine two-mouth ids are the sorted compass pair of the two edges the water
 * meets; the six `src_*` ids are a headwater's single mouth. See
 * docs/rules/rivers.md and `engine/rivers.ChannelShape`.
 */
export type RiverShape =
  | "e_w"
  | "ne_sw"
  | "nw_se"
  | "ne_w"
  | "e_nw"
  | "e_sw"
  | "w_se"
  | "ne_se"
  | "nw_sw"
  | "src_e"
  | "src_ne"
  | "src_nw"
  | "src_w"
  | "src_sw"
  | "src_se"
  | "";

/** One built bridge: an edge, and the seat whose colour it wears. */
export interface BridgeView {
  player: number;
  e: Edge;
}

/**
 * Rivers (engine/rivers), as one viewer sees it. The module has no hidden
 * state; fields are optional only so a client degrades against an older
 * server.
 */
export interface RiversExt {
  /** The derived watercourses, in the order the board derivation chose them. */
  rivers?: River[];
  /**
   * Every bridge site on the board, flat. Redundant with the per-river lists;
   * this is the set a road renderer tests an edge against.
   */
  sites?: Edge[];
  bridges?: BridgeView[];
  /** Every seat's coin count, indexed by seat. Public, all of it. */
  coins?: number[];
  /** Every seat's remaining bridges, indexed by seat. */
  bridges_left?: number[];
  /**
   * Which seats hold a Poorest Settler tile, indexed by seat. Several is
   * normal: every player tied for fewest coins gets one, which is the whole
   * table at the start of setup.
   */
  poorest?: boolean[];
  /** The seat holding the Wealthiest Settler tile, or -1 when a tie means nobody does. */
  wealthiest?: number;
  /**
   * False alongside Wagons and Raiders, which drop the -2 tile, so the seat
   * rail hides the row. Absent reads as false, which is safe: a game using the
   * tile always has a holder, and the `poorest` array brings the row back.
   */
  poorest_in_play?: boolean;
  /** How many bridges a player may ever build, so "2 of 3" needs no constant here. */
  bridge_supply?: number;
  /** What a bridge costs, as a Hand, for the same reason. */
  bridge_cost?: Hand;
  /** What two coins buy: one resource of the player's choice. */
  coin_per_res?: number;
  /** Coin-to-resource purchases still available this turn, of the two a turn allows. */
  spends_left?: number;
  /** The two tiles' victory contributions: +1 and -2. */
  wealthiest_vp?: number;
  poorest_vp?: number;
}

export function riversExt(v: FullView): RiversExt | undefined {
  return v.ext?.rivers as RiversExt | undefined;
}

/**
 * One rider on the board: a seat-tinted figure standing on a path. Not a
 * raider: a raider is a neutral figure on a hex, a rider is a seat's figure on
 * an edge.
 */
export interface RiderAt {
  player: number;
  e: Edge;
}

/**
 * One of the viewer's riders and where it may still go this turn. Shaped like
 * `engine.ShipMoveTargets`: `from` is the first click, `to` lights up for the
 * second.
 */
export interface RiderMoves {
  from: Edge;
  /** The 3-path allowance, free. */
  to: Edge[];
  /**
   * The extra destinations 1 grain buys for this one rider, raising it to 5
   * paths. Absent when the grain buys nothing new. Priced per rider.
   */
  hurry?: Edge[];
  /**
   * This rider is on a castle path and has somewhere to go, so ending the turn
   * is refused until it moves. Absent (not false) for a rider with nowhere
   * legal to go, which may stay put.
   */
  must_leave?: boolean;
}

/** One raider Treason picks up and puts down. `from` absent = out of the supply. */
export interface TreasonMove {
  from?: Hex;
  to: Hex;
}

/** The decision Raiders is waiting on, if any. */
export type RaidersPendKind =
  | "raiders_path"
  | "raiders_landing"
  | "raiders_muster"
  | "raiders_swift"
  | "raiders_treason"
  | "raiders_intrigue"
  | "raiders_steal";

/**
 * The open Raiders decision.
 *
 * `kind` and `seat` reach everyone, so the board and log can say who the table
 * is waiting on. The pick lists (`hexes`, `edges`, `treason_from`,
 * `treason_to`) reach only the seat being asked, and that is how the client
 * decides "is this mine". See `raidersRole` in lib/raiders.
 */
export interface RaidersPend {
  kind: RaidersPendKind;
  seat: number;
  /** A landing's remaining numbers, in the order rolled. Landing only. */
  numbers?: number[];
  hexes?: Hex[];
  edges?: Edge[];
  /** Treason: hexes a raider may be taken from. */
  treason_from?: Hex[];
  /** Treason: hexes a raider may be put on. */
  treason_to?: Hex[];
  /** Treason: how many moves the plan must carry. The engine's own count. */
  treason_count?: number;
}

/**
 * Raiders (engine/raiders), as one viewer sees it.
 *
 * Every field is optional: an older server may omit one, and an inert module
 * sends nothing. Two absences carry meaning:
 *
 *  - `castle` absent means the scenario is not running on this board. It is
 *    absent rather than zeroed because {q:0,r:0} is a real hex, usually where
 *    the castle sits.
 *  - `rider_moves` and the `pend` pick lists are viewer-only; absent means
 *    "not you", not "nothing to do".
 *
 * Nothing is redacted: cards resolve the moment they are bought, gold and
 * prisoners are public, and every figure stands on the board.
 */
export interface RaidersExt {
  shared_paths?: boolean;
  relocation_hexes?: Hex[];
  path_figures?: { hex: Hex; edge: Edge; alive: boolean; on_path: boolean }[];
  /**
   * The landing-eligible coastal hexes, ascending (q, r). Fixed at setup; sizes
   * the supply and sets the battle sweep's order.
   */
  coast?: Hex[];
  /** How many raiders stand on each `coast` hex, index for index. Three = conquered. */
  raider_count?: number[];
  /**
   * Raiders left in the neutral supply. When it empties, landings stop and
   * building carries no risk: the scenario's clock. Meaningless alongside
   * Knights, where the supply is unbounded.
   */
  supply?: number;
  /** Every rider on the board, in path order. Not sorted here; it arrives sorted. */
  riders?: RiderAt[];
  /** Riders each seat still has in hand, out of `riders_per_seat`. */
  riders_left?: number[];
  /**
   * Prisoners held, per seat. Two are worth 1 VP (three alongside Knights); a
   * lone prisoner is worth nothing. `prisonerVP` in lib/raiders is the only
   * place that arithmetic lives.
   */
  prisoners?: number[];
  /** Gold held, per seat. Public, and not a resource: no hand limit, unstealable. */
  gold?: number[];
  /** Cards left of each kind: [muster, swift_rider, treason, intrigue]. */
  deck?: number[];
  /** The component limit, six, served rather than hardcoded here. */
  riders_per_seat?: number;
  /** Gold-for-resource purchases left to the active seat this turn, out of two. */
  gold_buys_left?: number;
  /**
   * The castle hex. Absent, never zeroed, when the module is inert. Not a
   * terrain: the tile underneath keeps its resource and number, so the client
   * draws the castle over it and hides the number chip.
   */
  castle?: Hex;
  /** The castle's six paths, where riders enter. Present only with `castle`. */
  castle_paths?: Edge[];
  /** The saturated hexes: three raiders each. Absent, not empty, when there are none. */
  conquered?: Hex[];
  /** The viewer's own riders that may still move this turn. Viewer-only. */
  rider_moves?: RiderMoves[];
  /** The open decision, or absent. */
  pend?: RaidersPend;
}

export function raidersExt(v: FullView): RaidersExt | undefined {
  return v.ext?.raiders as RaidersExt | undefined;
}

/**
 * The Wagons scenario's view.
 *
 * Everything public at the table. The order of the three cargo stacks is not
 * sent (the server derives it from the private seed on demand); only each
 * stack's remaining count is.
 *
 * Rules constants (movement track, gold price, drive-off floors) are sent too,
 * so the client keeps no second copy.
 */
export interface WagonsExt {
  shared_currency?: boolean;
  /** The three trade hexes, their roles and their cargo cycle. */
  trade?: WagonsTradeHex[];
  /** Where the three barbarians stand. */
  barbarians?: Edge[];
  barbarian_ids?: number[];
  path_tried?: boolean[];
  /** Every wagon on the board, by seat. A seat with none is absent. */
  wagons?: { player: number; v: Vertex }[];
  /** Per seat. Gold is a count, never cards, and never a victory point. */
  gold?: number[];
  /** Per seat, 1..5 on the upgrade track. */
  level?: number[];
  /** Per seat: the cargo the wagon is carrying, 0 when empty. Public. */
  cargo?: number[];
  /** Per seat: delivered cargo tokens, 1 VP each. */
  delivered?: number[];
  /** Per seat: playable + locked Swift Journeys, as a count. */
  swift_held?: number[];
  /** The viewer's own Swift Journeys: playable, and bought this turn (locked). */
  swift?: number;
  swift_new?: number;
  /** How many Swift Journeys are still in the deck. */
  swift_left?: number;
  /** Whether the wagons are on the board yet (they arrive on the first turn). */
  started?: boolean;
  has_trade?: boolean;
  /** The seat whose movement phase is open, and how that phase stands. */
  turn_seat?: number;
  move_open?: boolean;
  move_done?: boolean;
  moved?: boolean;
  mp?: number;
  boosted?: boolean;
  bought?: number;
  /** Which barbarians this turn's wagon has already tried to drive off. */
  tried?: boolean[];
  /** The seat owing a barbarian move, and which one (-1 = its choice). */
  barb_seat?: number;
  barb_index?: number;
  /** Rules constants, published so the client keeps no second copy. */
  mp_track?: number[];
  max_level?: number;
  gold_price?: number;
  buys_a_turn?: number;
  stack_depth?: number;
  /** The lowest die that drives a barbarian off at each level; 7 means never. */
  drive_floors?: number[];
}

/** One trade hex: where it is, what it takes in and what it sends out. */
export interface WagonsTradeHex {
  hex: Hex;
  /** 0 castle, 1 quarry, 2 glassworks. */
  role: number;
  /**
   * The plaza: the intersection at the hex's centre where cargo changes hands.
   * Its `side` is past the two corner sides, which makes it unbuildable.
   */
  plaza: Vertex;
  accepts: number[];
  ships: number[];
  /** Tokens left in this hex's stack before it is refilled. */
  left: number;
}

export function wagonsExt(v: FullView): WagonsExt | undefined {
  const ext = v.ext?.wagons as WagonsExt | undefined;
  const raiders = raidersExt(v);
  if (!ext || !raiders?.shared_paths) return ext;
  const figures = (raiders.path_figures ?? [])
    .map((r, id) => ({ ...r, id }))
    .filter((r) => r.alive && r.on_path);
  return {
    ...ext,
    barbarians: figures.map((r) => r.edge),
    barbarian_ids: figures.map((r) => r.id),
    tried: ext.path_tried ?? [],
  };
}
