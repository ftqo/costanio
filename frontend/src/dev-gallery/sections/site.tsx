// Gallery section: site. Every site-level component outside the game HUD and
// outside components/ui, in every state it can show, rendered through the real
// components with fixture data. See ../spec.tsx.
//
// Three techniques keep this honest without touching any component:
//
//  - Fixture data comes through the components' own data paths: a scoped
//    `fetch` shim that answers only URLs carrying a gallery-only id (so no
//    other section and no real request is affected), and a private
//    QueryClient seeded with the store's queries.
//  - Fixed-position components (GameDock, ReplayPlayer, LoadingScreen) sit in
//    a box with a `transform`, which makes it their containing block, so they
//    stay in their group.
//  - What depends on the viewport width, portals to <body>, or needs `100dvh`
//    (the hamburger, the phone lobby header, the connection banner, the store
//    and settings dialogs, the error boundary) is rendered by this same
//    section inside an <iframe> sized for it (`?section=site&frame=<name>`),
//    where the portal and media queries are scoped to the frame.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Group, State, Break } from "../spec";
import { SiteHeader, ProfileMenu, type NavKey, type SessionAction } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { BrandPill } from "@/components/BrandPill";
import { PipIcon } from "@/components/PipIcon";
import { RatingBadge } from "@/components/RatingBadge";
import { DecoratedName } from "@/components/DecoratedName";
import { ThemeToggle, ThemeIcon } from "@/components/ThemeToggle";
import { LanguagePicker } from "@/components/LanguagePicker";
import { SettingsPanel, type AppSettings } from "@/components/SettingsPanel";
import { GameDock } from "@/components/GameDock";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PageTitle } from "@/components/PageTitle";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { ErrorBoundary } from "@/lib/ErrorBoundary";
import { TableClosedScreen } from "@/components/game/TableClosedScreen";
import { LobbyHeader } from "@/components/lobby/LobbyHeader";
import { ExpansionShelf, ExpansionCard } from "@/components/lobby/ExpansionShelf";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { StoreContent, StoreDialog } from "@/components/StoreShelves";
import { CosmeticGallery, CosmeticSlot } from "@/components/CosmeticGallery";
import { DiscordIcon, GoogleIcon } from "@/components/ProviderIcons";
import { LegalDoc, P, B, A, Bullets, type LegalSection } from "@/components/LegalDoc";
import { NotFound } from "@/routes/NotFound";
import { GeneratePanel, SeedControls, type RollMode } from "@/routes/mapbuilder/GeneratePanel";
import { WarningsPanel } from "@/routes/mapbuilder/WarningsPanel";
import { DesignEditor } from "@/routes/mapbuilder/DesignEditor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Segmented } from "@/components/ui/segmented";
import { Menu, MenuItem } from "@/components/ui/menu";
import { iconButtonVariants } from "@/components/ui/iconButton";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  DotsThreeVertical,
  Eye,
  FilmStrip,
  LockSimple,
  ShieldCheck,
  Trophy,
} from "@/lib/icons";
import { gameSocket } from "@/lib/ws";
import { useAuth } from "@/lib/auth";
import { seatColor } from "@/lib/hexgeo";
import { rulesetTags, type Expansions } from "@/lib/format";
import type { CbMode } from "@/lib/colorblind";
import type { Board, ColorView, CosmeticItem, MapIssue, Me } from "@/lib/types";
import type { MatchSummary } from "@/lib/matches";
import previewBoard from "@/lib/__fixtures__/previewBoard.json";

export const title = "Site components";

// ---------------------------------------------------------------------------
// Fixture network: answers only gallery-owned URLs, passes everything else on.
// ---------------------------------------------------------------------------

const UID_HISTORY = 990001; // a full page of matches (Load more shows)
const UID_EMPTY = 990002; // no matches yet
const UID_LOADING = 990003; // never answers
const UID_ERROR = 990004; // the history request fails
const UID_SHORT = 990005; // three rows, for the row-action states

const NOW_S = Math.floor(Date.UTC(2026, 9, 6, 18, 0) / 1000);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
const never = () => new Promise<Response>(() => {});

/** A seat in a match summary. */
function seat(
  s: number,
  name: string,
  vp: number,
  opts: { uid?: number; bot?: boolean; color?: string } = {},
) {
  return {
    seat: s,
    user_id: opts.uid ?? (opts.bot ? 0 : 1000 + s),
    name,
    is_bot: !!opts.bot,
    color: opts.color,
    vp,
  };
}

function historyRows(uid: number, n: number): MatchSummary[] {
  const shapes: Omit<MatchSummary, "game_id" | "finished_at">[] = [
    {
      ruleset: "base",
      ranked: true,
      winner: 0,
      players: [
        seat(0, "Mara", 10, { uid }),
        seat(1, "Teo", 7),
        seat(2, "Ines", 6),
        seat(3, "Oskar", 5),
      ],
    },
    {
      ruleset: "base+cak",
      ranked: true,
      winner: 1,
      players: [
        seat(0, "Mara", 11, { uid }),
        seat(1, "Teo", 13),
        seat(2, "Ines", 9),
        seat(3, "Bot Aldo", 8, { bot: true }),
      ],
    },
    {
      ruleset: "base+islands",
      ranked: false,
      winner: -1,
      players: [seat(0, "Mara", 9, { uid }), seat(1, "Teo", 9), seat(2, "Ines", 8)],
    },
    {
      ruleset: "base+fishermen+caravans",
      ranked: false,
      winner: 2,
      players: [
        seat(0, "Teo", 8, { color: "#8c9eff" }),
        seat(1, "Ines", 7, { color: "#e0a23a" }),
        seat(2, "Mara", 11, { uid, color: "#2bb3a3" }),
        seat(3, "Oskar", 6, { color: "#c2577a" }),
      ],
    },
    {
      ruleset: "base+raiders+rivers",
      ranked: false,
      winner: 4,
      players: [
        seat(0, "Mara", 8, { uid }),
        seat(1, "Teo", 9),
        seat(2, "Ines", 7),
        seat(3, "Oskar", 6),
        seat(4, "Bot Brin", 11, { bot: true }),
        seat(5, "Bot Cato", 5, { bot: true }),
      ],
    },
    {
      ruleset: "base+wagons+harbormaster",
      ranked: false,
      winner: 0,
      players: [seat(0, "Mara", 11, { uid }), seat(1, "Bot Aldo", 7, { bot: true })],
    },
    {
      ruleset: "base+explorers+cak",
      ranked: false,
      winner: 1,
      players: [seat(0, "Mara", 12, { uid }), seat(1, "Teo", 13), seat(2, "Ines", 10)],
    },
  ];
  return Array.from({ length: n }, (_, i) => ({
    ...shapes[i % shapes.length],
    game_id: `gallery-site-m${uid}-${i}`,
    finished_at: NOW_S - i * 86_400 * 2 - i * 3_600,
  }));
}

/** What the rejoin dock reads for each gallery game id. */
const DOCK_VIEWS: Record<string, unknown> = {
  "gallery-site-dock-yours": {
    viewer: 0,
    cur: 0,
    phase: "main",
    seat_names: ["Mara", "Teo", "Ines"],
    pending_discards: [0, 0, 0],
  },
  "gallery-site-dock-discard": {
    viewer: 0,
    cur: 1,
    phase: "main",
    seat_names: ["Mara", "Teo", "Ines"],
    pending_discards: [4, 0, 0],
  },
  "gallery-site-dock-theirs": {
    viewer: 0,
    cur: 1,
    phase: "main",
    seat_names: ["Mara", "Teo", "Ines"],
    pending_discards: [0, 0, 0],
  },
  "gallery-site-dock-longname": {
    viewer: 0,
    cur: 2,
    phase: "main",
    seat_names: ["Mara", "Teo", "Maximiliana Throckmorton-Vasquez"],
    pending_discards: [0, 0, 0],
  },
};

function fixtureResponse(url: URL): Promise<Response> | null {
  const p = url.pathname;
  const users = /^\/api\/users\/(\d+)\/matches$/.exec(p);
  if (users) {
    const uid = Number(users[1]);
    if (uid === UID_HISTORY)
      return Promise.resolve(
        json({ matches: url.searchParams.get("before") ? [] : historyRows(uid, 20) }),
      );
    if (uid === UID_SHORT) return Promise.resolve(json({ matches: historyRows(uid, 3) }));
    if (uid === UID_EMPTY) return Promise.resolve(json({ matches: [] }));
    if (uid === UID_LOADING) return never();
    if (uid === UID_ERROR) return Promise.resolve(json({ code: "INTERNAL" }, 500));
    return null;
  }
  if (!p.includes("gallery-site-")) return null;
  // A match record: one never answers (detail loading), the rest fail (detail
  // error); see the expanded-row specimens.
  if (p.startsWith("/api/matches/")) {
    if (p.endsWith(`m${UID_SHORT}-0`)) return never();
    return Promise.resolve(json({ code: "INTERNAL" }, 500));
  }
  // A downloaded log: the first row's spins forever, the second is refused.
  if (p.endsWith("/replay")) {
    if (p.includes("-0/")) return never();
    return Promise.resolve(json({ code: "RATE_LIMITED" }, 429));
  }
  const dock = /^\/api\/games\/(gallery-site-dock-[a-z]+)$/.exec(p);
  if (dock) {
    const view = DOCK_VIEWS[dock[1]];
    return Promise.resolve(view ? json({ view }) : json({ code: "NOT_FOUND" }, 404));
  }
  return null;
}

declare global {
  interface Window {
    __gallerySiteFetch?: boolean;
  }
}
if (typeof window !== "undefined" && !window.__gallerySiteFetch) {
  window.__gallerySiteFetch = true;
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const hit = fixtureResponse(new URL(raw, window.location.href));
      if (hit) return hit;
    } catch {
      /* not a URL we own */
    }
    return real(input, init);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Picker = (root: HTMLElement) => HTMLElement | null | undefined;

/**
 * Drives a real component into a state that only an interaction reaches (a
 * menu open, a confirm step), by clicking inside its own subtree once the
 * target exists. Never anything that creates, joins or leaves a game, and
 * never a purchase.
 */
function AutoClick({
  steps,
  children,
  className,
  style,
}: {
  steps: Picker[];
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let i = 0;
    let tries = 0;
    const id = setInterval(() => {
      const root = ref.current;
      if (!root || i >= steps.length || ++tries > 150) {
        clearInterval(id);
        return;
      }
      const el = steps[i](root);
      if (el) {
        el.click();
        i++;
      }
    }, 120);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

const byText =
  (selector: string, re: RegExp): Picker =>
  (root) =>
    Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
      (el) => re.test(el.textContent ?? "") && !(el as HTMLButtonElement).disabled,
    );
const first =
  (selector: string): Picker =>
  (root) =>
    root.querySelector<HTMLElement>(selector);

/** A box that is the containing block for `position: fixed` descendants. */
function Contain({
  w,
  h,
  children,
}: {
  w: number | string;
  h: number | string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        transform: "translateZ(0)",
        position: "relative",
        overflow: "hidden",
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}

/** This section rendered at another size, for what a viewport decides. */
function Frame({ name, w, h }: { name: string; w: number; h: number }) {
  return (
    <iframe
      title={name}
      src={`/dev/gallery?section=site&frame=${name}`}
      style={{ width: w, height: h, border: 0, borderRadius: 10, display: "block" }}
    />
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function me(over: Partial<Me> & { id: number; name: string }): Me {
  return { avatar: "", guest: false, stats: null, online: true, game: "", ...over };
}

const stat = (ruleset: string, games: number, wins: number, elo: number) => ({
  ruleset,
  games,
  wins,
  elo,
});

const MARA = me({
  id: 4101,
  name: "Mara",
  pips: 2400,
  stats: [
    stat("base", 42, 15, 1482),
    stat("base+cak", 12, 5, 1431),
    stat("base+islands", 8, 3, 1600),
  ],
});
const TEO_PROVISIONAL = me({ id: 4102, name: "Teo", pips: 150, stats: [stat("base", 4, 2, 1512)] });
const INES_UNRATED = me({
  id: 4103,
  name: "Ines",
  pips: 0,
  stats: [stat("base+islands", 6, 2, 1550)],
});
const GUEST = me({ id: 4104, name: "Guest 4104", guest: true });

const SESSION_ACTIONS: SessionAction[] = [
  {
    key: "spectate",
    label: "Leave & Spectate",
    icon: <Eye weight="bold" size={15} />,
    onSelect: () => {},
  },
  {
    key: "reset",
    label: "Reset to lobby",
    icon: <ArrowCounterClockwise weight="bold" size={15} />,
    onSelect: () => {},
    tone: "danger",
  },
];

function client(loadout: Record<string, string>) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
  qc.setQueryData(["loadout"], { loadout });
  return qc;
}

const item = (
  id: string,
  slot: string,
  name: string,
  o: Partial<CosmeticItem> = {},
): CosmeticItem => ({
  id,
  slot,
  name,
  price: 0,
  supporter: false,
  booster: false,
  kofi: false,
  staff: false,
  gift: false,
  owned: false,
  equipped: false,
  locked: false,
  ...o,
});

const STORE_ITEMS: CosmeticItem[] = [
  // Piece sets: the stock card is equipped because nothing else is.
  item("pieces.classic", "pieces", "Classic Set", { price: 1200, owned: true }),
  item("pieces.cyclades", "pieces", "Cyclades Set", { price: 3000 }),
  // Robbers.
  item("robber.brazier", "robber", "Brazier", { price: 900, owned: true, equipped: true }),
  item("robber.crow", "robber", "Crow", { price: 900, owned: true }),
  item("robber.keg", "robber", "Keg", { price: 1200 }),
  item("robber.hourglass", "robber", "Hourglass", { price: 4000 }),
  item("robber.sentinel", "robber", "Sentinel", { supporter: true, locked: true }),
  item("robber.brigand", "robber", "Brigand", { booster: true, locked: true }),
  item("robber.shard", "robber", "Shard", { price: 2500, reserved: true, locked: true }),
  // Name decorations.
  item("decoration.fire_blue", "decoration", "Blue Fire", {
    price: 800,
    owned: true,
    equipped: true,
  }),
  item("decoration.sparkle_red", "decoration", "Red Sparkle", { price: 800, owned: true }),
  item("decoration.fire_green", "decoration", "Green Fire", { price: 800 }),
  item("decoration.fire_purple", "decoration", "Purple Fire", { price: 900 }),
  item("decoration.fire_orange", "decoration", "Orange Fire", { price: 5200 }),
  item("decoration.supporter", "decoration", "Supporter", { supporter: true, locked: true }),
  item("decoration.kofi", "decoration", "Ko-fi", { kofi: true, locked: true }),
  item("decoration.booster", "decoration", "Booster", {
    booster: true,
    supporter: true,
    locked: true,
  }),
  item("decoration.staff", "decoration", "Staff", { staff: true, locked: true }),
];

const color = (id: string, name: string, hex: string, o: Partial<ColorView> = {}): ColorView => ({
  id,
  name,
  hex,
  free: false,
  available: false,
  price: 0,
  ...o,
});

const FREE_HEX = [
  ["red", "Red", "#d64545"],
  ["blue", "Blue", "#3f74d6"],
  ["orange", "Orange", "#e48a2a"],
  ["white", "White", "#f2efe6"],
  ["green", "Green", "#3e9b4f"],
  ["brown", "Brown", "#8a5a3b"],
  ["teal", "Teal", "#2bb3a3"],
  ["pink", "Pink", "#e27aa8"],
  ["purple", "Purple", "#8257c9"],
  ["yellow", "Yellow", "#e5c63a"],
] as const;
const STORE_COLORS: ColorView[] = [
  ...FREE_HEX.map(([id, name, hex]) =>
    color(`color.${id}`, name, hex, { free: true, available: true }),
  ),
  color("color.periwinkle", "Periwinkle", "#8c9eff", { available: true, price: 1500 }),
  color("color.midnight", "Midnight", "#2c3e66", { price: 1800 }),
  color("color.saffron", "Saffron", "#f0a92b", { price: 6000 }),
  color("color.moss", "Moss", "#6f8f3a", { price: 1800 }),
  color("color.aurora", "Aurora", "#59d6b5"),
  color("color.ember", "Ember", "#c84a2a"),
  color("color.glacier", "Glacier", "#a8d8ea"),
  color("color.plum", "Plum", "#6b2d5c"),
];

const storeClient = (() => {
  const qc = client({
    color: "color.teal",
    decoration: "decoration.fire_blue",
    robber: "robber.brazier",
    pieces: "",
  });
  qc.setQueryData(["wallet"], { balance: 2400, recent: [] });
  qc.setQueryData(["cosmetics"], { items: STORE_ITEMS });
  qc.setQueryData(["colors"], { colors: STORE_COLORS });
  return qc;
})();
const decoratedClient = client({ decoration: "decoration.fire_blue" });

function useFixtureSettings(init: Partial<AppSettings> = {}): AppSettings {
  const [volume, setVolume] = React.useState(init.volume ?? 80);
  const [sounds, toggleSounds] = React.useState(init.sounds ?? true);
  const [music, setMusic] = React.useState(init.music ?? false);
  const [cbMode, setCbMode] = React.useState<CbMode>(init.cbMode ?? "off");
  const [boardPostFx, setBoardPostFx] = React.useState(init.boardPostFx ?? false);
  const [placementMarks, setPlacementMarks] = React.useState(init.placementMarks ?? true);
  return {
    volume,
    setVolume,
    sounds,
    toggleSounds,
    music,
    setMusic,
    colorblind: cbMode !== "off",
    setColorblind: (on: boolean) => setCbMode(on ? "deutan" : "off"),
    cbMode,
    setCbMode,
    boardPostFx,
    setBoardPostFx,
    placementMarks,
    setPlacementMarks,
  };
}

const NO_EXP: Expansions = {
  islands: false,
  knights: false,
  fishermen: false,
  caravans: false,
  harbormaster: false,
  rivers: false,
  raiders: false,
  wagons: false,
  explorers: false,
};

/** The board the map builder edits: the committed preview fixture, with the
 *  module-only terrains read as desert (the builder paints base terrain). */
const EDITOR_BOARD: Board = (() => {
  const b = previewBoard.board as unknown as Board;
  return {
    ...b,
    tiles: b.tiles.map((t) =>
      (t.res as string) === "lake" || (t.res as string) === "swamp"
        ? { ...t, res: "none", num: 0 }
        : t,
    ),
  };
})();

const BLANK_BOARD: Board = {
  radius: 2,
  robber: { q: 0, r: 0 },
  harbors: [],
  tiles: EDITOR_BOARD.tiles.map((t) => ({ ...t, res: "land", num: 0 })),
};

const ISSUES: MapIssue[] = [
  { severity: "error", code: "no_desert", hexes: [] },
  { severity: "error", code: "number_on_nonproducing", hexes: [{ q: 0, r: 0 }] },
  { severity: "warning", code: "harbor_shared_hex", hexes: [{ q: 2, r: -1 }] },
  { severity: "warning", code: "gallery_unknown_code", hexes: [] },
];

const LEGAL_SECTIONS: LegalSection[] = [
  {
    id: "gallery-legal-who",
    title: "Who we are",
    body: (
      <P>
        costan.io is run by <B>one person</B>. Write to{" "}
        <A href="mailto:hello@example.com">the contact address</A> with anything on this page.
      </P>
    ),
  },
  {
    id: "gallery-legal-what",
    title: "What we keep",
    body: (
      <>
        <P>Only what the game needs to run:</P>
        <Bullets
          items={[
            "Your display name and the identity you signed in with.",
            <>
              Every game's <B>event log</B>, so replays and audits work.
            </>,
            "Chat messages, for moderation.",
          ]}
        />
      </>
    ),
  },
  {
    id: "gallery-legal-how",
    title: "How long",
    body: <P>Until you ask us to delete your account. Finished games stay replayable.</P>,
  },
];

const NAV_KEYS: (NavKey | undefined)[] = [
  undefined,
  "lobby",
  "leaderboard",
  "replay",
  "mapbuilder",
  "howto",
  "support",
  "store",
  "profile",
];

// ---------------------------------------------------------------------------
// Stateful wrappers (state lives here; the components are the real ones)
// ---------------------------------------------------------------------------

function ShelfDemo({
  initial,
  disabled = false,
  ...rest
}: {
  initial: Partial<Expansions>;
  disabled?: boolean;
} & Omit<React.ComponentProps<typeof ExpansionShelf>, "exp" | "onToggle" | "disabled">) {
  const [exp, setExp] = React.useState<Expansions>({ ...NO_EXP, ...initial });
  return (
    <div className="w-95 flex flex-col gap-2.5">
      <ExpansionShelf
        exp={exp}
        onToggle={(k, on) => setExp((e) => ({ ...e, [k]: !on }))}
        disabled={disabled}
        {...rest}
      />
    </div>
  );
}

function SettingsDemo({ init }: { init?: Partial<AppSettings> }) {
  const settings = useFixtureSettings(init);
  return (
    <div className="w-80">
      <SettingsPanel settings={settings} />
    </div>
  );
}

function GenerateDemo({
  centerDesert,
  rollMode,
  blanks,
  busy = false,
}: {
  centerDesert: boolean;
  rollMode: RollMode;
  blanks: boolean;
  busy?: boolean;
}) {
  const [cd, setCd] = React.useState(centerDesert);
  const [rm, setRm] = React.useState<RollMode>(rollMode);
  return (
    <div className="w-70">
      <GeneratePanel
        seeds={{ onRandomizeResources: () => {}, blanks, disabled: false, busy }}
        centerDesert={cd}
        onCenterDesertChange={setCd}
        rollMode={rm}
        onRollModeChange={setRm}
      />
    </div>
  );
}

function EditorDemo({ tool, board }: { tool: "shape" | "tiles" | "harbors"; board: Board }) {
  const [b, setB] = React.useState(board);
  return (
    <div className="w-[520px]">
      <DesignEditor
        board={b}
        onBoardChange={setB}
        issues={[]}
        highlightHexes={[]}
        initialTool={tool}
        onReset={() => setB(BLANK_BOARD)}
      />
    </div>
  );
}

/** The waiting room's header, with its slots composed as routes/Lobby.tsx
 *  composes them (that route's controls are not exported). */
function LobbySlots({ host, codeShown }: { host: boolean; codeShown?: boolean }) {
  const [priv, setPriv] = React.useState<"private" | "public">("private");
  const [showCode, setShowCode] = React.useState(!!codeShown);
  return (
    <LobbyHeader
      host="Mara"
      seatButtons={
        <>
          <Button variant="secondary" size="sm">
            <ArrowLeft weight="bold" />
            Leave
          </Button>
          {host ? (
            <Button variant="secondary" size="sm">
              Spectate
            </Button>
          ) : (
            <Button size="sm">Take a seat</Button>
          )}
        </>
      }
      privacyControl={
        host ? (
          <Segmented<"private" | "public">
            variant="joined"
            value={priv}
            onChange={setPriv}
            options={[
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ]}
          />
        ) : (
          <div className="inline-flex items-center gap-1.5 bg-secondary-background border border-border rounded-control px-3 py-1.5 text-[13px] font-medium text-muted">
            <LockSimple weight="bold" />
            Private
          </div>
        )
      }
      inviteControls={
        <>
          <div className="hidden min-[720px]:flex squat:hidden! items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowCode((v) => !v)}>
              {showCode ? <span className="font-num tabular-nums">KX7Q2M</span> : "Show code"}
            </Button>
            <Button variant="secondary" size="sm">
              Copy link
            </Button>
          </div>
          <Menu
            className="min-[720px]:hidden squat:block!"
            align="end"
            contentClassName="min-w-45"
            triggerClassName={iconButtonVariants({ size: "sm" })}
            triggerLabel="Invite options"
            trigger={<DotsThreeVertical weight="bold" aria-hidden />}
          >
            <MenuItem keepOpen onSelect={() => setShowCode((v) => !v)}>
              {showCode ? <span className="font-num tabular-nums">KX7Q2M</span> : "Show code"}
            </MenuItem>
            <MenuItem onSelect={() => {}}>Copy link</MenuItem>
          </Menu>
        </>
      }
      profileMenu={<ProfileMenu me={host ? MARA : TEO_PROVISIONAL} />}
    />
  );
}

function Throw(): React.ReactNode {
  throw new Error("gallery specimen: ErrorBoundary fallback");
}

/** A socket that dials and never connects, so the banner's wait is real. */
function deadSocket() {
  return {
    readyState: 0,
    send() {},
    close() {},
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
}

/** Holds the frame's own session socket down (only inside the iframe). */
function ConnFrame({ kind }: { kind: "reconnect" | "first" }) {
  React.useEffect(() => {
    const sock = gameSocket as unknown as {
      wsFactory: () => unknown;
      getSnapshot: () => { everOpen: boolean };
    };
    let tries = 0;
    const id = setInterval(() => {
      // Wait for Root's socket to have opened once, so "reconnect" is true.
      if (kind === "reconnect" && !sock.getSnapshot().everOpen && ++tries < 50) return;
      clearInterval(id);
      if (kind === "first") gameSocket.disconnect();
      sock.wsFactory = deadSocket;
      if (kind === "first") gameSocket.follow("gallery-site-conn");
      else gameSocket.reconnectNow();
    }, 100);
    return () => clearInterval(id);
  }, [kind]);
  return null;
}

function SettingsDialogFrame() {
  const { me: who } = useAuth();
  return (
    <AutoClick
      className="flex items-start justify-end p-4"
      steps={[first("[data-ui-menu-trigger]"), byText('[role="menuitem"]', /Settings/)]}
    >
      <ProfileMenu me={who ?? MARA} />
    </AutoClick>
  );
}

/** What this section draws inside one of its own iframes. */
function FrameContent({ name }: { name: string }) {
  let body: React.ReactNode = null;
  switch (name) {
    case "narrow-header":
      body = <SiteHeader active="lobby" compact />;
      break;
    case "narrow-header-open":
      body = (
        <AutoClick steps={[first("[data-ui-menu-trigger]")]}>
          <SiteHeader active="lobby" compact />
        </AutoClick>
      );
      break;
    case "narrow-lobby-host":
      body = <LobbySlots host />;
      break;
    case "narrow-lobby-guest-menu":
      body = (
        <AutoClick steps={[first('[aria-label="Invite options"]')]}>
          <LobbySlots host={false} codeShown />
        </AutoClick>
      );
      break;
    case "narrow-footer":
      body = <SiteFooter />;
      break;
    case "conn-reconnect":
      body = <ConnFrame kind="reconnect" />;
      break;
    case "conn-first":
      body = <ConnFrame kind="first" />;
      break;
    case "error-boundary":
      body = (
        <ErrorBoundary>
          <Throw />
        </ErrorBoundary>
      );
      break;
    case "store-dialog":
      body = <StoreDialog open onOpenChange={() => {}} />;
      break;
    case "settings-dialog":
      body = <SettingsDialogFrame />;
      break;
    case "loading-narrow":
      body = <LoadingScreen />;
      break;
  }
  return (
    <div style={{ "--game-dock-h": "0px" } as React.CSSProperties} className="h-dvh">
      {/* Inside the frame only: drop the gallery's own padding and heading. */}
      <style>{`[data-gallery]{padding:0!important;gap:0!important}[data-section]{gap:0!important}[data-section]>h2{display:none}`}</style>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

export function Section() {
  const frame = new URLSearchParams(window.location.search).get("frame");
  if (frame) return <FrameContent name={frame} />;
  return (
    // The rejoin dock writes `--game-dock-h` on <html> while it is mounted, to
    // pad the footer; reset here so the footer specimens show their own size.
    <div className="flex flex-col gap-6" style={{ "--game-dock-h": "0px" } as React.CSSProperties}>
      <HeaderGroups />
      <SmallParts />
      <ControlsGroups />
      <DockAndStatus />
      <PageChrome />
      <LobbyGroups />
      <ProfileAndReplay />
      <StoreGroups />
      <MapBuilderGroups />
    </div>
  );
}

function HeaderGroups() {
  return (
    <>
      <Group
        id="site/header-nav"
        title="SiteHeader: each active nav item (signed in as you)"
        surface="ground"
        wide
      >
        <div className="flex flex-col gap-3 w-full">
          {NAV_KEYS.map((k) => (
            <State
              key={k ?? "none"}
              label={
                k
                  ? `active="${k}"${k === "profile" ? " (no nav item: none lit)" : ""}`
                  : "no active item"
              }
            >
              <div className="w-[1060px]">
                <SiteHeader active={k} />
              </div>
            </State>
          ))}
          <State label="compact (content pages), active=leaderboard">
            <div className="w-[1060px]">
              <SiteHeader active="leaderboard" compact />
            </div>
          </State>
        </div>
      </Group>

      <Group
        id="site/header-narrow"
        title="SiteHeader at 390px: hamburger replaces wordmark and nav"
        surface="ground"
      >
        <State label="hamburger closed">
          <Frame name="narrow-header" w={390} h={80} />
        </State>
        <State label="hamburger open">
          <Frame name="narrow-header-open" w={390} h={460} />
        </State>
      </Group>

      <Group id="site/profile-menu" title="ProfileMenu: every account kind, open" surface="ground">
        {(
          [
            ["registered, rated (1482 · Base Game)", MARA, false],
            ["provisional rating (1512?)", TEO_PROVISIONAL, false],
            ["unrated (only unranked rulesets)", INES_UNRATED, false],
            ["guest", GUEST, false],
            ["in a live game: session actions", MARA, true],
          ] as const
        ).map(([label, who, actions]) => (
          <State key={label} label={label}>
            <AutoClick
              steps={[first("[data-ui-menu-trigger]")]}
              className="w-[280px] flex items-start justify-end"
              style={{ height: actions ? 420 : who.guest ? 290 : 320 }}
            >
              <ProfileMenu me={who} sessionActions={actions ? SESSION_ACTIONS : undefined} />
            </AutoClick>
          </State>
        ))}
        <State label="with an equipped name decoration">
          <QueryClientProvider client={decoratedClient}>
            <AutoClick
              steps={[first("[data-ui-menu-trigger]")]}
              className="w-[280px] flex items-start justify-end"
              style={{ height: 320 }}
            >
              <ProfileMenu me={MARA} />
            </AutoClick>
          </QueryClientProvider>
        </State>
        <State label="trigger, closed">
          <ProfileMenu me={MARA} />
        </State>
        <State label="trigger, hover" force="hover">
          <ProfileMenu me={TEO_PROVISIONAL} />
        </State>
      </Group>

      <Group id="site/footer" title="SiteFooter" surface="ground" wide>
        <State label="with rule (content pages)">
          <div className="w-[1060px]">
            <SiteFooter />
          </div>
        </State>
        <State label="rule={false} (homepage, over the board)">
          <div className="w-[1060px]">
            <SiteFooter rule={false} />
          </div>
        </State>
        <State label="390px (wraps)">
          <Frame name="narrow-footer" w={390} h={130} />
        </State>
      </Group>
    </>
  );
}

const HEADER_WORDMARK =
  "font-wordmark font-[800] text-on-background text-[20px] leading-none tracking-[1px] px-1 py-1.5 rounded-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function SmallParts() {
  return (
    <>
      <Group id="site/brand-pill" title="BrandPill, as each caller dresses it" surface="ground">
        <State label="site header wordmark">
          <BrandPill className={HEADER_WORDMARK} />
        </State>
        <State label="site header wordmark, focus-visible" force="focus-visible">
          <BrandPill className={HEADER_WORDMARK} />
        </State>
        <State label="loading-card pill">
          <BrandPill className="bg-secondary-background border-2 border-border rounded-full px-4 py-1.5 text-[16px] font-extrabold tracking-[1px] shadow-hard-sm" />
        </State>
        <State label="login card (on a card)">
          <div className="bg-secondary-background rounded-card px-4 py-2">
            <BrandPill className="self-center font-wordmark text-[20px] font-extrabold tracking-[1px] text-foreground" />
          </div>
        </State>
        <State label="bare (no caller classes)">
          <BrandPill />
        </State>
      </Group>

      <Group id="site/pip-icon" title="PipIcon">
        <State label="1em in body text (currentColor)">
          <span className="text-[14px]">
            <PipIcon /> 2,400
          </span>
        </State>
        <State label="amber ink (store, on a panel)">
          <span className="text-[14px] font-num tabular-nums">
            <PipIcon className="text-amber-ink" /> 2,400
          </span>
        </State>
        <State label="balance size (28px)">
          <span className="font-display text-[28px] font-heavy leading-none">
            <PipIcon className="text-amber-ink" /> 2,400
          </span>
        </State>
        <State label="size 12 / 16 / 24 / 40">
          <span className="flex items-end gap-3 text-amber-ink">
            <PipIcon size={12} />
            <PipIcon size={16} />
            <PipIcon size={24} />
            <PipIcon size={40} />
          </span>
        </State>
      </Group>

      <Group
        id="site/pip-icon-ground"
        title="PipIcon on the page ground (inherits on-background)"
        surface="ground"
      >
        <State label="currentColor">
          <span className="text-[16px] text-on-background">
            <PipIcon /> 2,400
          </span>
        </State>
        <State label="header pip chip (as SiteHeader draws it)">
          <Link
            to="/store"
            className="flex items-center gap-1.5 h-8 bg-secondary-background text-foreground border border-border rounded-control shadow-hard-sm px-3 text-[13px] font-semibold font-num tabular-nums"
          >
            <PipIcon className="text-amber-ink" />
            2,400
          </Link>
        </State>
      </Group>

      <Group id="site/rating-badge" title="RatingBadge (raw Elo, no tiers)">
        <State label="established (42 games)">
          <RatingBadge elo={1482} games={42} />
        </State>
        <State label="provisional (4 games): dim + ?">
          <RatingBadge elo={1512} games={4} />
        </State>
        <State label="provisional flag from server">
          <RatingBadge elo={1500} provisional />
        </State>
        <State label="with ruleset (Base)">
          <RatingBadge elo={1482} games={42} ruleset="base" />
        </State>
        <State label="with ruleset (Knights)">
          <RatingBadge elo={1431} games={12} ruleset="base+cak" />
        </State>
        <State label="provisional + ruleset">
          <RatingBadge elo={1512} games={4} ruleset="base+cak" />
        </State>
        <State label="high (2104)">
          <RatingBadge elo={2103.6} games={310} />
        </State>
        <State label="low (812)">
          <RatingBadge elo={812} games={55} />
        </State>
        <Break />
        {(["xs", "sm", "md", "lg"] as const).map((s) => (
          <State key={s} label={`size ${s}`}>
            <RatingBadge elo={1482} games={42} size={s} />
          </State>
        ))}
        {(["xs", "md"] as const).map((s) => (
          <State key={`p${s}`} label={`size ${s}, provisional`}>
            <RatingBadge elo={1512} games={4} size={s} />
          </State>
        ))}
      </Group>

      <Group id="site/decorated-name" title="DecoratedName">
        {(
          [
            ["no decoration", undefined],
            ["unknown id (plain)", "decoration.nope"],
            ["Supporter (sparkle blue)", "decoration.supporter"],
            ["Booster (sparkle pink)", "decoration.booster"],
            ["Ko-fi (sparkle yellow)", "decoration.kofi"],
            ["Staff (red fire)", "decoration.staff"],
            ["Blue Fire", "decoration.fire_blue"],
            ["Black Fire", "decoration.fire_black"],
            ["White Fire", "decoration.fire_white"],
            ["Green Sparkle", "decoration.sparkle_green"],
            ["Purple Sparkle", "decoration.sparkle_purple"],
          ] as const
        ).map(([label, id]) => (
          <State key={label} label={label}>
            <span className="text-[15px] font-extrabold">
              <DecoratedName decoration={id}>Mara</DecoratedName>
            </span>
          </State>
        ))}
        <Break />
        <State label="long name, 13px row text">
          <span className="text-[13px] font-semibold">
            <DecoratedName decoration="decoration.fire_purple">
              Maximiliana Throckmorton
            </DecoratedName>
          </span>
        </State>
        <State label="17px">
          <span className="text-[17px] font-semibold">
            <DecoratedName decoration="decoration.sparkle_teal">Teo</DecoratedName>
          </span>
        </State>
      </Group>

      <Group
        id="site/provider-buttons"
        title="Login buttons: ProviderIcons in Button, as routes/Login composes them"
      >
        <State label="Discord">
          <div className="w-80">
            <Button tone="discord" className="w-full" size="md">
              <DiscordIcon className="h-5 w-5" />
              Continue with Discord
            </Button>
          </div>
        </State>
        <State label="Discord, hover" force="hover">
          <Button tone="discord" className="w-80" size="md">
            <DiscordIcon className="h-5 w-5" />
            Continue with Discord
          </Button>
        </State>
        <State label="Google">
          <div className="w-80">
            <Button tone="google" className="w-full" size="md">
              <GoogleIcon className="h-5 w-5" />
              Continue with Google
            </Button>
          </div>
        </State>
        <State label="Google, hover" force="hover">
          <Button tone="google" className="w-80" size="md">
            <GoogleIcon className="h-5 w-5" />
            Continue with Google
          </Button>
        </State>
        <State label="header Log in (signed-out header)">
          <Button asChild size="sm" tone="discord">
            <Link to="/login">Log in</Link>
          </Button>
        </State>
        <State label="icons alone, 24px">
          <span className="flex items-center gap-3">
            <DiscordIcon className="h-6 w-6" />
            <GoogleIcon className="h-6 w-6" />
          </span>
        </State>
      </Group>
    </>
  );
}

function ControlsGroups() {
  return (
    <>
      <Group
        id="site/theme-toggle"
        title="ThemeToggle (draws the current theme; captured once per theme)"
        surface="ground"
      >
        <State label="rest">
          <ThemeToggle />
        </State>
        <State label="hover" force="hover">
          <ThemeToggle />
        </State>
        <State label="active" force="active">
          <ThemeToggle />
        </State>
        <State label="focus-visible" force="focus-visible">
          <ThemeToggle />
        </State>
        <State label="ThemeIcon light / dark">
          <span className="flex items-center gap-3 text-on-background">
            <ThemeIcon resolved="light" />
            <ThemeIcon resolved="dark" />
          </span>
        </State>
      </Group>

      <Group id="site/language-picker" title="LanguagePicker" surface="ground">
        <State label="closed">
          <LanguagePicker />
        </State>
        <State label="open (align end)">
          <AutoClick
            steps={[first('[aria-haspopup="menu"]')]}
            className="w-[260px] flex items-start justify-end"
            style={{ height: 470 }}
          >
            <LanguagePicker />
          </AutoClick>
        </State>
        <State label="390px: short label (in the header)">
          <Frame name="narrow-header" w={390} h={80} />
        </State>
      </Group>

      <Group
        id="site/settings-panel"
        title="SettingsPanel (fixture settings; Theme reads the real stored pref)"
      >
        <State label="defaults">
          <SettingsDemo />
        </State>
        <State label="sounds off, music on, volume 0, post-fx on, marks off">
          <SettingsDemo
            init={{
              volume: 0,
              sounds: false,
              music: true,
              boardPostFx: true,
              placementMarks: false,
            }}
          />
        </State>
        <State label="colorblind on (deutan): palette picker">
          <SettingsDemo init={{ cbMode: "deutan" }} />
        </State>
        <State label="colorblind tritan, volume 100">
          <SettingsDemo init={{ cbMode: "tritan", volume: 100 }} />
        </State>
      </Group>

      <Group
        id="site/settings-dialog"
        title="Settings dialog (ProfileMenu, then Settings; the real modal, in a frame)"
        surface="ground"
      >
        <State label="open">
          <Frame name="settings-dialog" w={520} h={780} />
        </State>
      </Group>
    </>
  );
}

function DockAndStatus() {
  const dock = (node: React.ReactNode, w = 440) => (
    <Contain w={w} h={104}>
      {node}
    </Contain>
  );
  return (
    <>
      <Group
        id="site/game-dock-loud"
        title="GameDock, loud (amber ring, primary Rejoin)"
        surface="ground"
      >
        <State label="no table state: Still in progress">{dock(<GameDock />)}</State>
        <State label="your turn">{dock(<GameDock gameId="gallery-site-dock-yours" />)}</State>
        <State label="cards to discard">
          {dock(<GameDock gameId="gallery-site-dock-discard" />)}
        </State>
        <State label="someone else's turn">
          {dock(<GameDock gameId="gallery-site-dock-theirs" />)}
        </State>
        <State label="long name wraps (360px)">
          {dock(<GameDock gameId="gallery-site-dock-longname" />, 360)}
        </State>
        <State label="custom title + subtitle">
          {dock(<GameDock title="Mara's table" subtitle="Waiting for players" />)}
        </State>
        <State label="table unreadable (404): default caption">
          {dock(<GameDock gameId="gallery-site-dock-gone" />)}
        </State>
      </Group>

      <Group id="site/game-dock-quiet" title="GameDock, quiet (secondary Rejoin)" surface="ground">
        <State label="Still in progress">{dock(<GameDock variant="quiet" />)}</State>
        <State label="your turn">
          {dock(<GameDock variant="quiet" gameId="gallery-site-dock-yours" />)}
        </State>
        <State label="cards to discard">
          {dock(<GameDock variant="quiet" gameId="gallery-site-dock-discard" />)}
        </State>
        <State label="someone else's turn">
          {dock(<GameDock variant="quiet" gameId="gallery-site-dock-theirs" />)}
        </State>
      </Group>

      <Group
        id="site/connection-indicator"
        title="ConnectionIndicator (the real banner; the frame's own socket is held down)"
        surface="ground"
      >
        <State label="reconnecting (shows after 1.5s)">
          <Frame name="conn-reconnect" w={480} h={110} />
        </State>
        <State label="first connect at a table">
          <Frame name="conn-first" w={480} h={110} />
        </State>
      </Group>
    </>
  );
}

function PageChrome() {
  return (
    <>
      <Group id="site/loading-screen" title="LoadingScreen" surface="ground">
        <State label="default (Loading table…)">
          <Contain w={480} h={340}>
            <LoadingScreen />
          </Contain>
        </State>
        <State label="custom message">
          <Contain w={480} h={340}>
            <LoadingScreen message="Finding you a seat…" />
          </Contain>
        </State>
        <State label="with children (the seat-roster slot)">
          <Contain w={480} h={420}>
            <LoadingScreen message="Dealing the board…">
              <div className="flex justify-center gap-3">
                {["Mara", "Teo", "Ines", "Oskar"].map((n, i) => (
                  <div key={n} className="flex flex-col items-center gap-1">
                    <Avatar color={seatColor(i)} name={n} size={36} />
                    <span className="text-[12px] font-semibold">{n}</span>
                  </div>
                ))}
              </div>
            </LoadingScreen>
          </Contain>
        </State>
        <State label="failed: actions replace the slider">
          <Contain w={480} h={340}>
            <LoadingScreen
              message="Couldn't reach the table."
              actions={
                <div className="flex justify-center gap-2">
                  <Button variant="secondary">Back to Play</Button>
                  <Button>Try again</Button>
                </div>
              }
            />
          </Contain>
        </State>
        <State label="390px frame">
          <Frame name="loading-narrow" w={390} h={420} />
        </State>
      </Group>

      <Group id="site/table-closed" title="TableClosedScreen" surface="ground">
        <State label="closed table">
          <Contain w={520} h={360}>
            <TableClosedScreen g="gallery-site-closed" />
          </Contain>
        </State>
      </Group>

      <Group
        id="site/error-boundary"
        title="ErrorBoundary fallback (a real thrown render, in a frame for its 100dvh)"
        surface="ground"
      >
        <State label="caught render error">
          <Frame name="error-boundary" w={640} h={380} />
        </State>
      </Group>

      <Group id="site/page-title" title="PageTitle" surface="ground" wide>
        <State label="title only">
          <PageTitle title="Leaderboard" />
        </State>
        <State label="icon + subtitle">
          <div className="w-[1000px]">
            <PageTitle
              icon={<Trophy weight="duotone" size={30} />}
              title="Leaderboard"
              subtitle="Ranked 4-player games, updated after every game"
            />
          </div>
        </State>
        <State label="with actions (right-aligned)">
          <div className="w-[1000px]">
            <PageTitle
              icon={<FilmStrip weight="duotone" size={30} />}
              title="Replays"
              subtitle="Watch any finished game back"
              actions={
                <>
                  <Button variant="secondary" size="sm">
                    Open a file
                  </Button>
                  <Button size="sm">Latest game</Button>
                </>
              }
            />
          </div>
        </State>
        <State label="narrow (420px): subtitle and actions wrap">
          <div className="w-[420px]">
            <PageTitle
              icon={<ShieldCheck weight="duotone" size={30} />}
              title="Verify a game"
              subtitle="Check a finished game against the seed we committed to"
              actions={<Button size="sm">Paste a log</Button>}
            />
          </div>
        </State>
      </Group>

      <Group
        id="site/screen-pagebody"
        title="Screen + SiteHeader + PageBody + PageTitle (a content page's frame)"
        surface="ground"
        wide
      >
        <State label="content page">
          <Contain w={1060} h={460}>
            <Screen>
              <SiteHeader active="leaderboard" compact />
              <PageBody>
                <PageTitle
                  icon={<Trophy weight="duotone" size={30} />}
                  title="Leaderboard"
                  subtitle="Ranked 4-player games"
                />
                <Card className="px-5 py-4 text-[14px]">A card in the page column.</Card>
              </PageBody>
            </Screen>
          </Contain>
        </State>
        <State label="center, noFooter (empty / auth states)">
          <Contain w={520} h={260}>
            <Screen center noFooter>
              <Card className="px-6 py-5 text-[14px]">Centred on the bare ground.</Card>
            </Screen>
          </Contain>
        </State>
      </Group>

      <Group id="site/not-found" title="NotFound (routes/NotFound, exported)" surface="ground" wide>
        <State label="404 page">
          <Contain w={1060} h={520}>
            <NotFound />
          </Contain>
        </State>
      </Group>

      <Group
        id="site/legal-doc"
        title="LegalDoc chrome (the Terms / Privacy layout, fixture sections)"
        surface="ground"
        wide
      >
        <State label="contents + sections">
          <div className="w-[1060px]">
            <LegalDoc
              title="Privacy Policy"
              updated="2026-06-23"
              intro={
                <P>
                  This page says what costan.io keeps about you and why. It is short because we keep
                  very little.
                </P>
              }
              sections={LEGAL_SECTIONS}
            />
          </div>
        </State>
      </Group>
    </>
  );
}

function LobbyGroups() {
  const card = (label: string, p: Omit<React.ComponentProps<typeof ExpansionCard>, "onToggle">) => (
    <State label={label}>
      <div className="w-95">
        <ExpansionCard {...p} onToggle={() => {}} />
      </div>
    </State>
  );
  const knights = {
    moduleKey: "cak",
    name: "Knights",
    blurb:
      "City improvements, knights, and barbarian invasions. No development deck, and you play to 13. Longer, heavier games.",
    beta: false,
    disabled: false,
  };
  return (
    <>
      <Group
        id="site/lobby-header"
        title="LobbyHeader, desktop (slots composed as routes/Lobby does)"
        surface="ground"
        wide
      >
        <State label="host, seated, code hidden">
          <div className="w-[1060px]">
            <LobbySlots host />
          </div>
        </State>
        <State label="spectator: read-only privacy, Take a seat, code shown">
          <div className="w-[1060px]">
            <LobbySlots host={false} codeShown />
          </div>
        </State>
        <State label="760px: right cluster wraps">
          <div className="w-[760px]">
            <LobbySlots host />
          </div>
        </State>
      </Group>

      <Group
        id="site/lobby-header-phone"
        title="LobbyHeader, phone layout (390px frame)"
        surface="ground"
      >
        <State label="host">
          <Frame name="narrow-lobby-host" w={390} h={110} />
        </State>
        <State label="spectator, invite kebab open">
          <Frame name="narrow-lobby-guest-menu" w={390} h={220} />
        </State>
      </Group>

      <Group id="site/expansion-card" title="ExpansionCard (one row of the shelf)">
        {card("off", { ...knights, on: false })}
        {card("on", { ...knights, on: true })}
        {card("beta badge", {
          moduleKey: "harbormaster",
          name: "Harbormaster",
          blurb:
            "A 2 point card for whoever builds most on the harbours, and one more point to win.",
          beta: true,
          on: false,
          disabled: false,
        })}
        <Break />
        {card("blocked by a conflict (reason in red, dimmed)", {
          moduleKey: "wagons",
          name: "Wagons",
          blurb: "Haul cargo between three trade hexes. No robber, no longest road.",
          beta: false,
          on: false,
          disabled: false,
          blockedReason: "Wagons and Islands can't share a board.",
        })}
        {card("locked from outside (muted reason)", {
          moduleKey: "islands",
          name: "Islands",
          blurb:
            "Ships, sea routes, and bonus points for settling new islands. Needs a map with sea.",
          beta: false,
          on: true,
          disabled: false,
          lockedReason: "Your map has separate landmasses, so ships are needed.",
        })}
        {card("disabled (not the host), on", { ...knights, on: true, disabled: true })}
      </Group>

      <Group id="site/expansion-shelf" title="ExpansionShelf (real conflict and warning tables)">
        <State label="lobby: nothing on, scenarios collapsed">
          <ShelfDemo initial={{}} />
        </State>
        <State label="Knights + Islands: conflicts block">
          <ShelfDemo initial={{ knights: true, islands: true }} />
        </State>
        <State label="Caravans + Wagons: warning note">
          <ShelfDemo initial={{ caravans: true, wagons: true }} />
        </State>
        <State label="not the host: every switch disabled">
          <ShelfDemo initial={{ knights: true, fishermen: true }} disabled />
        </State>
        <State label="map builder: Islands locked, no heading">
          <ShelfDemo
            initial={{ islands: true }}
            locked={{ islands: "Your map has separate landmasses, so ships are needed." }}
            coreHeading={false}
          />
        </State>
        <State label="Explorers on (refuses most partners)">
          <ShelfDemo initial={{ explorers: true }} />
        </State>
        <State label="allowScenarios=false">
          <ShelfDemo initial={{}} allowScenarios={false} />
        </State>
      </Group>
    </>
  );
}

function ProfileAndReplay() {
  const downloads = (root: HTMLElement) =>
    root.querySelectorAll<HTMLElement>('button[aria-label="Download replay"]');
  return (
    <>
      <Group
        id="site/match-history"
        title="MatchHistory: win / loss / draw rows, every ruleset tag, Load more"
        surface="ground"
        wide
      >
        <State label="a full page (20 rows)">
          <div className="w-[1000px]">
            <MatchHistory userId={UID_HISTORY} />
          </div>
        </State>
      </Group>

      <Group
        id="site/match-history-states"
        title="MatchHistory: list and row states"
        surface="ground"
        wide
      >
        <State label="loading">
          <div className="w-[320px]">
            <MatchHistory userId={UID_LOADING} />
          </div>
        </State>
        <State label="empty">
          <div className="w-[320px]">
            <MatchHistory userId={UID_EMPTY} />
          </div>
        </State>
        <State label="failed">
          <div className="w-[320px]">
            <MatchHistory userId={UID_ERROR} />
          </div>
        </State>
        <Break />
        <State label="row 1 expanded (detail loading); downloads: row 1 busy, row 2 refused (red)">
          <AutoClick
            className="w-[1000px]"
            steps={[
              first("button[aria-expanded]"),
              (root) => downloads(root)[0],
              (root) => downloads(root)[1],
            ]}
          >
            <MatchHistory userId={UID_SHORT} />
          </AutoClick>
        </State>
        <State label="row 2 expanded, detail failed">
          <AutoClick
            className="w-[1000px]"
            steps={[(root) => root.querySelectorAll<HTMLElement>("button[aria-expanded]")[1]]}
          >
            <MatchHistory userId={UID_SHORT} />
          </AutoClick>
        </State>
      </Group>

      <Group
        id="site/replay-player"
        title="ReplayPlayer (the homepage's recorded game, its full-screen view contained)"
        surface="ground"
        wide
      >
        <State label="at the start, paused">
          <ReplayBox seek={null} />
        </State>
        <State label="scrubbed to mid-game, a seat's hand opened, speed 2x">
          <ReplayBox seek={0.5} />
        </State>
      </Group>
    </>
  );
}

const ReplayPlayerFixture = React.lazy(async () => {
  const [{ ReplayPlayer }, { ATTRACT }] = await Promise.all([
    import("@/components/replay/ReplayPlayer"),
    import("@/lib/replay/attract"),
  ]);
  function Fixture() {
    const tags = rulesetTags(ATTRACT.meta.ruleset);
    return (
      <ReplayPlayer
        source={ATTRACT}
        seats={[
          { seat: 0, name: "Mara" },
          { seat: 1, name: "Teo" },
          { seat: 2, name: "Ines" },
        ]}
        title={
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              {tags.map((t) => (
                <Badge
                  key={t.label}
                  tone="ruleset"
                  size="xs"
                  style={{ "--badge-fill": t.bg } as React.CSSProperties}
                >
                  {t.label}
                </Badge>
              ))}
              <span className="text-[12px] text-muted">3 players</span>
            </div>
            <div className="text-[15px] font-semibold">Teo won, 10 to 9</div>
          </div>
        }
      />
    );
  }
  return { default: Fixture };
});

function ReplayBox({ seek }: { seek: number | null }) {
  const steps: Picker[] =
    seek === null
      ? []
      : [
          (root) => {
            const input = root.querySelector<HTMLInputElement>('input[type="range"]');
            if (!input) return null;
            const lo = Number(input.min);
            const to = Math.round(lo + (Number(input.max) - lo) * seek);
            // The native setter, so React sees the change; it is called with `input` bound.
            // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked via .call(input)
            const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            set?.call(input, String(to));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            // Something inert to "click", so the step counts as done.
            return root.querySelector<HTMLElement>("aside .hud-lab");
          },
          byText("aside button[aria-pressed]", /^Teo/),
          byText("aside button[aria-pressed]", /^2/),
        ];
  return (
    <Contain w={1060} h={620}>
      <AutoClick steps={steps} className="w-full h-full">
        <React.Suspense fallback={<div className="p-6 text-on-background">Loading replay…</div>}>
          <ReplayPlayerFixture />
        </React.Suspense>
      </AutoClick>
    </Contain>
  );
}

function StoreGroups() {
  // One card out of a whole StoreContent body: its children are the balance,
  // the supporter panel, the colour shelf, then one card per item section.
  // Literal class strings, so Tailwind's scanner generates them.
  const ONLY_SUPPORTER = "[&>*:not(:nth-child(2))]:hidden flex flex-col gap-4 w-[760px]";
  const ONLY_COLORS = "[&>*:not(:nth-child(3))]:hidden flex flex-col gap-4 w-[760px]";
  const pick = (name: string, then?: RegExp): Picker[] => [
    first(`button[title^="${name}"]`),
    ...(then ? [byText("button", then)] : []),
  ];
  const colorState = (label: string, steps: Picker[]) => (
    <State label={label}>
      <AutoClick steps={steps} className={ONLY_COLORS}>
        <StoreContent>{(body) => body}</StoreContent>
      </AutoClick>
    </State>
  );
  return (
    <QueryClientProvider client={storeClient}>
      <Group
        id="site/store-content"
        title="Store body (StoreContent): balance, supporter pitch, colours, every item-card state"
        surface="ground"
        wide
      >
        <State label="balance 2,400; Green Fire in its confirm step; stills by CosmeticGallery">
          <AutoClick
            steps={[
              (root) =>
                Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
                  (b) =>
                    /^Buy/.test(b.textContent ?? "") &&
                    !b.disabled &&
                    /Green Fire/.test(b.parentElement?.textContent ?? ""),
                ),
            ]}
            className="w-[1000px]"
          >
            <StoreContent>
              {(body, seatCol) => (
                <CosmeticGallery seatColor={seatCol}>
                  <div className="flex flex-col gap-4">{body}</div>
                </CosmeticGallery>
              )}
            </StoreContent>
          </AutoClick>
        </State>
      </Group>

      <Group
        id="site/store-supporter"
        title="SupporterPanel (through StoreContent; shows the pitch or the thank-you for your real account)"
        surface="ground"
      >
        <State label="as your account sees it">
          <div className={ONLY_SUPPORTER}>
            <StoreContent>{(body) => body}</StoreContent>
          </div>
        </State>
      </Group>

      <Group
        id="site/store-color-shelf"
        title="ColorShelf: the picked swatch's detail row in each state"
        surface="ground"
        wide
      >
        {colorState("nothing picked (● marks the equipped Teal)", [])}
        {colorState("picked: equipped", pick("Teal"))}
        {colorState("picked: owned, Equip", pick("Periwinkle"))}
        {colorState("picked: affordable, Buy", pick("Midnight"))}
        {colorState("picked: affordable, confirm step", pick("Moss", /^Buy/))}
        {colorState("picked: unaffordable (Need … more)", pick("Saffron"))}
        {colorState("picked: supporter colour, Support to unlock", pick("Aurora"))}
      </Group>

      <Group
        id="site/store-dialog"
        title="StoreDialog (the real modal with your live store data, in a frame)"
        surface="ground"
      >
        <State label="open">
          <Frame name="store-dialog" w={980} h={760} />
        </State>
      </Group>

      <Group
        id="site/cosmetic-gallery"
        title="CosmeticGallery: CosmeticSlot stills (pointer hover turns them live)"
      >
        {(
          [
            ["Default pieces", "pieces.stock"],
            ["Classic Set", "pieces.classic"],
            ["Cyclades Set", "pieces.cyclades"],
            ["Stock robber", "robber.stock"],
            ["Brazier", "robber.brazier"],
            ["Crow", "robber.crow"],
            ["Sentinel", "robber.sentinel"],
          ] as const
        ).map(([label, id]) => (
          <State key={id} label={label}>
            <CosmeticGallery seatColor={seatColor(0)}>
              <CosmeticSlot
                id={id}
                className="bg-secondary-background rounded-base aspect-[3/4] w-[140px]"
              />
            </CosmeticGallery>
          </State>
        ))}
        <Break />
        {["#2bb3a3", "#8257c9", "#e48a2a"].map((hex) => (
          <State key={hex} label={`Classic Set in ${hex}`}>
            <CosmeticGallery seatColor={hex}>
              <CosmeticSlot
                id="pieces.classic"
                className="bg-secondary-background rounded-base aspect-[3/4] w-[140px]"
              />
            </CosmeticGallery>
          </State>
        ))}
        <State label="outside a gallery (no still)">
          <CosmeticSlot
            id="robber.crow"
            className="bg-secondary-background rounded-base aspect-[3/4] w-[140px]"
          />
        </State>
      </Group>
    </QueryClientProvider>
  );
}

function MapBuilderGroups() {
  return (
    <>
      <Group id="site/mapbuilder-generate" title="Map builder: GeneratePanel / SeedControls">
        <State label="first roll: Generate board, Balanced, desert centred">
          <GenerateDemo centerDesert rollMode="fair" blanks />
        </State>
        <State label="Randomize resources, Random, desert free">
          <GenerateDemo centerDesert={false} rollMode="random" blanks={false} />
        </State>
        <State label="busy (rolling)">
          <GenerateDemo centerDesert rollMode="fair" blanks={false} busy />
        </State>
        <State label="SeedControls compact (preview overlay)">
          <SeedControls
            compact
            onRandomizeResources={() => {}}
            blanks={false}
            disabled={false}
            busy={false}
          />
        </State>
        <State label="SeedControls disabled">
          <div className="w-60">
            <SeedControls onRandomizeResources={() => {}} blanks disabled busy={false} />
          </div>
        </State>
      </Group>

      <Group id="site/mapbuilder-warnings" title="Map builder: WarningsPanel">
        <State label="no issues">
          <div className="w-70">
            <WarningsPanel issues={[]} onHighlight={() => {}} />
          </div>
        </State>
        <State label="errors, then warnings (incl. an unknown code)">
          <div className="w-70">
            <WarningsPanel issues={ISSUES} onHighlight={() => {}} />
          </div>
        </State>
      </Group>

      <Group id="site/mapbuilder-editor" title="Map builder: DesignEditor, each tool" wide>
        <State label="Shape tool (blank land)">
          <EditorDemo tool="shape" board={BLANK_BOARD} />
        </State>
        <State label="Tiles tool (rolled board)">
          <EditorDemo tool="tiles" board={EDITOR_BOARD} />
        </State>
        <State label="Harbours tool">
          <EditorDemo tool="harbors" board={EDITOR_BOARD} />
        </State>
      </Group>
    </>
  );
}
