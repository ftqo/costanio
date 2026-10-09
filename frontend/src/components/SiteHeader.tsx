import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg, plural } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { CaretDown, ChatText, User, GearSix, SignOut, List, Storefront, X } from "@/lib/icons";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/iconButton";
import { DecoratedName } from "@/components/DecoratedName";
import { SettingsPanel, useAppSettings } from "@/components/SettingsPanel";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { LanguagePicker } from "@/components/LanguagePicker";
import { PipIcon } from "@/components/PipIcon";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";
import { rulesetLabel } from "@/lib/format";
import { highestRankedRating, isProvisional } from "@/lib/rating";
import { avatarColor } from "@/lib/avatarColor";
import { inActivityMode } from "@/lib/activity";
import { formatNumber } from "@/lib/intl";
import { BrandPill } from "@/components/BrandPill";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Tip } from "@/components/game/Tip";

// Re-exported for existing importers (Lobby/Profile/Landing/Leaderboard/…).
export { avatarColor };
// RatingLine renders the player's best ranked rating (labeled with its ruleset)
// on the profile menu; provisional ratings get a `?`. Unranked rulesets have no
// real rating, so none is shown for them. A component so it re-renders on a
// language change.
function RatingLine({ me }: { me: Me }) {
  const { t } = useLingui();
  const top = highestRankedRating(me.stats);
  if (!top) return <Trans>Unrated</Trans>;
  const rating = `${Math.round(top.elo)}${isProvisional(top.games) ? "?" : ""}`;
  const ruleset = rulesetLabel(top.ruleset);
  return (
    <>{t`${rating} · ${ruleset} · ${plural(top.games, { one: "# game", other: "# games" })}`}</>
  );
}

/**
 * The store, fetched when it is first opened rather than with the page.
 *
 * StoreShelves pulls in three.js through CosmeticGallery, and SiteHeader is in
 * the initial module graph, so a static import would add the renderer (~800 kB)
 * to the entry chunk.
 *
 * Mounted behind a latch (see `storeMounted` below), so the chunk loads on
 * first open and the dialog stays mounted after, keeping Radix's close fade.
 */
const StoreDialog = React.lazy(() =>
  import("@/components/StoreShelves").then((m) => ({ default: m.StoreDialog })),
);

export type NavKey =
  | "lobby"
  | "replay"
  | "leaderboard"
  | "mapbuilder"
  | "howto"
  | "profile"
  | "support"
  | "store";

// Descriptors, rendered with `i18n._()` at the call site, since module scope
// would freeze the import-time language. The one-word labels carry a context
// because the app uses those words elsewhere.
const NAV: { key: NavKey; label: MessageDescriptor; to: string }[] = [
  { key: "lobby", label: msg({ message: "Play", context: "site navigation" }), to: "/play" },
  {
    key: "leaderboard",
    label: msg({ message: "Leaderboard", context: "site navigation" }),
    to: "/leaderboard",
  },
  {
    key: "replay",
    label: msg({ message: "Replays", context: "site navigation" }),
    to: "/replay",
  },
  {
    key: "mapbuilder",
    label: msg({ message: "Map builder", context: "site navigation" }),
    to: "/map-builder",
  },
  {
    key: "howto",
    label: msg({ message: "How to play", context: "site navigation" }),
    to: "/how-to-play",
  },
  {
    key: "support",
    label: msg({ message: "Support", context: "site navigation" }),
    to: "/support",
  },
  { key: "store", label: msg({ message: "Store", context: "site navigation" }), to: "/store" },
];

// Full-bleed separator that spans the dropdown's padded width (so the line
// doesn't inset with item padding): a hairline. `data-ui-menu-sep` keeps the
// HUD's 2px rule inside a game (index.css, site-material block).
function MenuSep() {
  return <div data-ui-menu-sep="" className="border-t border-line -mx-1.5 my-1" />;
}

// Mobile nav hamburger: the inline nav's destinations plus Home. Shown below
// 720px, where the inline nav and wordmark are hidden. Never in the Discord
// Activity.
//
// Memoised with no props, so game-screen re-renders do not reach it.
export const HamburgerMenu = React.memo(function HamburgerMenu() {
  const navigate = useNavigate();
  // The hook subscribes to the i18n context, so a language change still
  // re-renders through the memo.
  const { i18n, t } = useLingui();
  if (inActivityMode()) return null;
  return (
    <Menu
      className="hidden max-[720px]:block squat:block shrink-0"
      align="start"
      shadow={false}
      // Matches the profile avatar at the other end of the row. On the site: a
      // 1px rim and a soft lift; inside a game the HUD restores its 3px round
      // ring (index.css, `[data-ui-menu-trigger].border`).
      //
      // The coarse-pointer halo is the HUD orbs' (hudOrbClasses): a 44px
      // target around the 36px face.
      triggerClassName="relative flex items-center justify-center w-9 h-9 rounded-control border border-border shadow-hard-sm bg-secondary-background cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0 transition-transform active:translate-y-px pointer-coarse:before:absolute pointer-coarse:before:-inset-1.75 pointer-coarse:before:content-['']"
      trigger={<List weight="bold" size={20} />}
      triggerLabel={t({ message: "Menu", context: "site navigation menu button" })}
    >
      <MenuItem onSelect={() => void navigate({ to: "/" })}>
        <Trans context="site navigation">Home</Trans>
      </MenuItem>
      {NAV.map((n) => (
        <MenuItem key={n.key} onSelect={() => void navigate({ to: n.to })}>
          {i18n._(n.label)}
        </MenuItem>
      ))}
    </Menu>
  );
});

/**
 * An action for the current session rather than the account ("Leave &
 * Spectate", "Reset to lobby"). The game screen builds these, since it knows
 * whether each is legal now; ProfileMenu only draws them.
 */
export type SessionAction = {
  key: string;
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  tone?: "default" | "danger";
};

// Memoised so game-screen socket frames do not re-render it. `me` changes only
// with the identity; callers must pass a stable `sessionActions` array (the
// game screen memoises it).
export const ProfileMenu = React.memo(function ProfileMenu({
  me,
  sessionActions,
}: {
  me: Me;
  /**
   * Actions for the current session, drawn below the account items. Only set
   * in a live game.
   */
  sessionActions?: SessionAction[];
}) {
  const { logout } = useAuth();
  const { t } = useLingui();
  const navigate = useNavigate();
  const [dialog, setDialog] = React.useState<null | "settings" | "store" | "feedback">(null);
  // Latched on the first open, never cleared. See StoreDialog above.
  const [storeMounted, setStoreMounted] = React.useState(false);
  // Owned here so the sound gate is initialized before Settings is ever opened.
  const settings = useAppSettings();
  const color = avatarColor(me.id);
  const loadoutQ = useQuery({ queryKey: ["loadout"], queryFn: api.loadout, staleTime: 60_000 });
  return (
    <>
      <Menu
        align="end"
        contentClassName="w-65"
        // The coarse-pointer halo the HUD orbs carry (see hudOrbClasses): 36px
        // face, 44px target.
        triggerClassName="relative flex items-center gap-1.5 rounded-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring transition-transform active:translate-y-px pointer-coarse:before:absolute pointer-coarse:before:-inset-1 pointer-coarse:before:content-['']"
        triggerLabel={t`Account menu`}
        trigger={
          // One piece: the avatar disc carries the keyline and edge itself, no
          // ring or gap around it, and the chevron is printed on the ground
          // beside it (pb-site.css, `data-pb-avatar-trigger`). Both press
          // together.
          <span data-pb-avatar-trigger="" className="flex items-center gap-1.5">
            <Avatar color={color} src={me.avatar || undefined} name={me.name} size={36} ring={0} />
            <CaretDown weight="bold" size={12} />
          </span>
        }
      >
        <div className="flex items-center gap-2.5 px-2 pt-1 pb-2">
          <Avatar color={color} src={me.avatar || undefined} name={me.name} size={40} ring={0} />
          <div>
            <div className="text-[15px] font-extrabold flex items-center gap-1.5">
              <DecoratedName decoration={loadoutQ.data?.loadout?.decoration}>
                {me.name}
              </DecoratedName>
            </div>
            <div className="text-[11px] font-bold text-muted">
              {me.guest ? (
                <Trans context="the kind of account, under a player's name">guest</Trans>
              ) : (
                <RatingLine me={me} />
              )}
            </div>
          </div>
        </div>
        <MenuSep />
        {/* In the Discord Activity, items that navigate away or log out are
            hidden. Store, Settings and Feedback are in-place dialogs, so they
            stay. */}
        {!inActivityMode() && (
          <MenuItem asChild>
            <Link to="/profile">
              <User weight="bold" size={15} />
              <Trans>View profile</Trans>
            </Link>
          </MenuItem>
        )}
        {/* The store as a dialog over the current screen. Inside the Activity
            this is the only way to it. See StoreDialog. */}
        <MenuItem
          onSelect={() => {
            setStoreMounted(true);
            setDialog("store");
          }}
        >
          <Storefront weight="bold" size={15} />
          <Trans context="site navigation">Store</Trans>
        </MenuItem>
        <MenuItem onSelect={() => setDialog("settings")}>
          <GearSix weight="bold" size={15} />
          <Trans>Settings</Trans>
        </MenuItem>
        <MenuItem onSelect={() => setDialog("feedback")}>
          <ChatText weight="bold" size={15} />
          <Trans>Send feedback</Trans>
        </MenuItem>
        {/* Session actions, separated by a rule and heading and placed last
            because they are destructive. Shown in the Discord Activity too:
            neither leaves the table (see leaveGame in routes/Game.tsx). */}
        {sessionActions && sessionActions.length > 0 && (
          <>
            <MenuSep />
            <div className="px-2.5 pt-0.5 pb-1 text-[12px] font-semibold text-muted">
              <Trans context="heading over actions for the game you are in right now">
                This game
              </Trans>
            </div>
            {sessionActions.map((a) => (
              <MenuItem key={a.key} onSelect={a.onSelect} tone={a.tone}>
                {a.icon}
                {a.label}
              </MenuItem>
            ))}
          </>
        )}
        {!inActivityMode() && (
          <>
            <MenuSep />
            <MenuItem
              onSelect={() => {
                void (async () => {
                  await logout();
                  void navigate({ to: "/" });
                })();
              }}
              tone="danger"
            >
              <SignOut weight="bold" size={15} />
              <Trans>Log out</Trans>
            </MenuItem>
          </>
        )}
      </Menu>

      {storeMounted && (
        <React.Suspense fallback={null}>
          <StoreDialog open={dialog === "store"} onOpenChange={(o) => !o && setDialog(null)} />
        </React.Suspense>
      )}

      <Dialog open={dialog === "settings"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="w-90 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <DialogTitle size="lg">
              <Trans>Settings</Trans>
            </DialogTitle>
            {/* The one dialog close: an IconButton piece, top right. */}
            <DialogClose asChild>
              <IconButton aria-label={t`Close`} title={t`Close`} className="ml-auto">
                <X weight="bold" size={16} />
              </IconButton>
            </DialogClose>
          </div>
          <SettingsPanel settings={settings} />
        </DialogContent>
      </Dialog>

      <FeedbackDialog open={dialog === "feedback"} onOpenChange={(o) => !o && setDialog(null)} />
    </>
  );
});

export function SiteHeader({ active, compact = false }: { active?: NavKey; compact?: boolean }) {
  const { t, i18n } = useLingui();
  const { me, loading } = useAuth();
  // In the Discord Activity the header carries only the inert wordmark. It
  // only shows in brief loading or error states.
  if (inActivityMode()) {
    return (
      <div
        className={cn(
          "flex items-center",
          compact ? "px-6 py-3.5 max-[640px]:px-3" : "px-6 py-4 max-[640px]:px-3",
        )}
      >
        <BrandPill className="font-wordmark font-[800] text-on-background text-[20px] leading-none tracking-[1px] px-1 py-1.5 rounded-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex items-center gap-5 max-[640px]:gap-2.5",
        compact ? "px-6 py-3.5 max-[640px]:px-3" : "px-6 py-4 max-[640px]:px-3",
      )}
    >
      {/* Desktop only: below 720px, and on a sideways phone (`squat`), the
          hamburger replaces it. */}
      <BrandPill className="max-[720px]:hidden squat:hidden font-wordmark font-[800] text-on-background text-[20px] leading-none tracking-[1px] px-1 py-1.5 rounded-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      <HamburgerMenu />
      {/* `flex-wrap`, so longer translations wrap to a second row instead of
          pushing the profile cluster off screen between 720px and ~920px.
          `whitespace-nowrap` per link keeps breaks between destinations. */}
      {/* The gap tightens below 1320px so the seven links stay on one row
          down to the hamburger breakpoint in English. */}
      <nav className="flex flex-wrap gap-x-5 max-[1320px]:gap-x-3.5 max-[1080px]:gap-x-2.5 gap-y-1 text-[14px] font-semibold max-[720px]:hidden squat:hidden">
        {NAV.map((n) => (
          <Link
            key={n.key}
            to={n.to}
            // On the ocean, so it uses the on-background pair (--foreground and
            // --muted have too little contrast there). The current page is lit
            // with a short bar under it; the rest are dimmed until hovered.
            aria-current={active === n.key ? "page" : undefined}
            className={cn(
              "relative whitespace-nowrap py-1 rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active === n.key
                ? "text-on-background font-bold after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-on-background"
                : "text-on-background-muted hover:text-on-background",
            )}
          >
            {i18n._(n.label)}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex gap-3 max-[640px]:gap-2 items-center">
        {/* Drawn for everybody, since signed-out visitors have no profile
            menu. */}
        <LanguagePicker />
        {/* Drawn for everybody, like the language picker. The game HUD's orb
            is the same control (see components/ThemeToggle). */}
        <ThemeToggle />
        {me && !me.guest && me.pips !== undefined && (
          <Tip title={t`Pips`} hint={t`Earned currency, spendable in the store.`}>
            <Link
              to="/store"
              // Hidden on the narrowest phones so the profile menu stays on
              // screen; the store is still in the hamburger and profile menus.
              // A link to the store, so a piece that hovers and presses like
              // the toggle beside it (pb-site.css, `data-pb-piece`).
              data-pb-piece=""
              className="flex max-[380px]:hidden items-center gap-1.5 h-8 bg-secondary-background text-foreground border border-transparent rounded-control px-3 text-[13px] font-semibold font-num tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PipIcon className="text-amber-ink" />
              {formatNumber(me.pips)}
            </Link>
          </Tip>
        )}
        {me ? (
          // Render as soon as there is an identity, including the cached one
          // on first paint, so returning users never see the login button.
          <ProfileMenu me={me} />
        ) : loading ? (
          // No cached identity yet and the initial /api/users/me check is still
          // in flight: a neutral avatar-sized placeholder rather than a login
          // button that might immediately be replaced by the profile menu.
          <div
            aria-hidden
            className="w-9 h-9 rounded-full bg-page-skeleton animate-pulse shrink-0"
          />
        ) : (
          // Green, the affirmative action: Discord's indigo stays on the
          // Discord provider button on the login page.
          <Button asChild size="sm" tone="accent">
            <Link to="/login">
              <Trans>Log in</Trans>
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}
