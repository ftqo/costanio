import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { Root } from "@/components/Root";
import { MIN_PLAYERS, MAX_PLAYERS } from "@/lib/format";
import { Landing } from "@/routes/Landing";
import { Play } from "@/routes/Play";
import { NotFound } from "@/routes/NotFound";
import { HOW_TO_PLAY_TABS } from "@/routes/howToPlayTabs";

/**
 * Every route except `/` and `/play`, fetched when wanted, so the landing page
 * does not evaluate the game screen, the 3D board, three.js or How to play.
 *
 * `defaultPreload: "intent"` below fetches a route on hover or touch-down, so
 * the module is usually loaded by the time a click lands. `/` and `/play` stay
 * eager because the app is opened on them, with no hover first. `/game` is
 * reached through a Start button the router preloads; a mid-game reload pays
 * the fetch it would have paid anyway.
 */
const lazily = <T extends Record<string, unknown>, K extends keyof T & string>(
  load: () => Promise<T>,
  name: K,
) => lazyRouteComponent(load, name);

const Lobby = lazily(() => import("@/routes/Lobby"), "Lobby");
const Game = lazily(() => import("@/routes/Game"), "Game");
const Profile = lazily(() => import("@/routes/Profile"), "Profile");
const Support = lazily(() => import("@/routes/Support"), "Support");
const Store = lazily(() => import("@/routes/Store"), "Store");
const HowToPlay = lazily(() => import("@/routes/HowToPlay"), "HowToPlay");
const Leaderboard = lazily(() => import("@/routes/Leaderboard"), "Leaderboard");
const Login = lazily(() => import("@/routes/Login"), "Login");
const MapBuilder = lazily(() => import("@/routes/MapBuilder"), "MapBuilder");
// Every UI element in every state, for styling work. Dev builds only.
const Gallery = lazily(() => import("@/dev-gallery/Gallery"), "Gallery");
const JoinInvite = lazily(() => import("@/routes/JoinInvite"), "JoinInvite");
const Terms = lazily(() => import("@/routes/Terms"), "Terms");
const Privacy = lazily(() => import("@/routes/Privacy"), "Privacy");
// Lazy: the replay page mounts Board3D and three.js, which most visitors never
// need.
const Replay = lazily(() => import("@/routes/Replay"), "Replay");
// The fairness audit. Lazy: it pulls in the verifier (board generation and all)
// for a page most visitors never open.
const Verify = lazily(() => import("@/routes/Verify"), "Verify");

/**
 * ?lang=<BCP-47>, a language hint. Nothing stamps it automatically; a link
 * can carry one by hand, e.g. to review a draft catalogue in the running app.
 *
 * It never writes storage and never outranks the player's own preference. An
 * unrecognised value falls through rather than erroring. The chain that
 * consumes it is in lib/i18n.ts.
 */
export const langSearch = (s: Record<string, unknown>): { lang?: string } => ({
  lang: typeof s.lang === "string" && s.lang ? s.lang : undefined,
});

const rootRoute = createRootRoute({
  component: Root,
  // On the root route so every route keeps it; a child validator's result is
  // merged over this one.
  validateSearch: langSearch,
  // An unknown URL gets a site page (header, a way home) rather than the
  // router's bare "Not Found". Eager: tiny, and its imports are already in the
  // first bundle.
  notFoundComponent: NotFound,
});

// game id carried as ?g=<id>
const gameSearch = (s: Record<string, unknown>): { g?: string; inv?: string } => ({
  g: typeof s.g === "string" ? s.g : undefined,
  // Optional invite, so a spectator can follow a private game into its rematch
  // lobby (the new lobby has a fresh invite code carried on the rematch frame).
  inv: typeof s.inv === "string" ? s.inv : undefined,
});

// Which rules tab is open: ?tab=<key>. The chapter within it rides the URL
// hash, which the page updates as you scroll. Needed for deep links like
// /how-to-play#ck-knights, whose target only exists once its tab is mounted;
// the game screen links to the rule behind a refusal this way.
const rulesSearch = (s: Record<string, unknown>): { tab?: string } => ({
  tab:
    typeof s.tab === "string" && (HOW_TO_PLAY_TABS as readonly string[]).includes(s.tab)
      ? s.tab
      : undefined,
});

// lobby browse filters: ?exp=<module[,module]> &players=<2-10> &open
const lobbySearch = (
  s: Record<string, unknown>,
): { exp?: string; players?: number; open?: boolean } => {
  const players = Number(s.players);
  return {
    exp: typeof s.exp === "string" && s.exp ? s.exp : undefined,
    players:
      Number.isInteger(players) && players >= MIN_PLAYERS && players <= MAX_PLAYERS
        ? players
        : undefined,
    open: s.open === true || s.open === "true" || s.open === "1" ? true : undefined,
  };
};

const routes = [
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: Landing,
    staticData: { title: msg`Costanio | Trade and settle the land of Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/play",
    component: Play,
    validateSearch: lobbySearch,
    staticData: { title: msg`Play | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/lobby",
    component: Lobby,
    validateSearch: gameSearch,
    staticData: { title: msg`Lobby | Costanio` },
  }),
  // /waiting-room redirects to /lobby (bookmarks, cached Discord Activity
  // routes), carrying the game id and invite.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/waiting-room",
    validateSearch: gameSearch,
    beforeLoad: ({ search }) => {
      // TanStack Router signals a redirect by throwing its `redirect()` result,
      // a plain control-flow object rather than an Error (documented API).
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: "/lobby", search });
    },
    component: () => null,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/game",
    component: Game,
    validateSearch: gameSearch,
    staticData: { title: msg`Game | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/profile",
    component: Profile,
    staticData: { title: msg`Profile | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/support",
    component: Support,
    staticData: { title: msg`Support | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/how-to-play",
    component: HowToPlay,
    validateSearch: rulesSearch,
    staticData: { title: msg`How to Play | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/leaderboard",
    component: Leaderboard,
    staticData: { title: msg`Leaderboard | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: Login,
    staticData: { title: msg`Log In | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/map-builder",
    component: MapBuilder,
    staticData: { title: msg`Map Builder | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/g/$code",
    component: JoinInvite,
    staticData: { title: msg`Join a Table | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/replay",
    component: Replay,
    // The same `?g=<id>` /game and /lobby carry.
    validateSearch: gameSearch,
    staticData: { title: msg`Replay | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/verify",
    component: Verify,
    // The same `?g=<id>` every other game-scoped route carries.
    validateSearch: gameSearch,
    staticData: { title: msg`Verify a Game | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/store",
    component: Store,
    staticData: { title: msg`Store | Costanio` },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/terms",
    component: Terms,
    staticData: { title: msg`Terms of Service | Costanio` },
  }),
  ...(import.meta.env.DEV
    ? [
        createRoute({
          getParentRoute: () => rootRoute,
          path: "/dev/gallery",
          component: Gallery,
        }),
      ]
    : []),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/privacy",
    component: Privacy,
    staticData: { title: msg`Privacy Policy | Costanio` },
  }),
];

const routeTree = rootRoute.addChildren(routes);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    /**
     * The browser tab title, as a message descriptor rather than a string.
     * This module is evaluated once at import, so Root.tsx translates it
     * (`i18n._`) when it sets `document.title`.
     */
    title?: MessageDescriptor;
  }
}
