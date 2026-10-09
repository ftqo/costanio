import * as React from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { useAuth } from "@/lib/auth";
import { gameSocket, useGameSocket } from "@/lib/ws";
import { GameDock } from "@/components/GameDock";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Spinner } from "@/components/ui/spinner";
import { RankedQueueProvider } from "@/components/RankedQueueProvider";
import { activityRoute, inActivityMode, runActivityBootstrap } from "@/lib/activity";
import { apiErrorText } from "@/lib/errorCopy";
import { getBearer } from "@/lib/session";
import { applyTheme, getStoredPref } from "@/lib/theme";

// The rejoin dock is global, but on these routes you're already in the table.
const DOCK_HIDDEN = new Set(["/game", "/lobby"]);

// The tab title for a route that declares none. A descriptor, as in router.tsx.
const DEFAULT_TITLE = msg`Costanio | Trade and settle the land of Costanio`;

/** Root route. In the Discord Activity it runs the SDK bootstrap, then routes
 * into the call's table. On the web it just renders the matched route. */
export function Root() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const { me, loading, refresh } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = useRouterState({ select: (s) => s.matches.at(-1)?.staticData.title });
  const [booting, setBooting] = React.useState(inActivityMode());
  const [err, setErr] = React.useState<string | null>(null);

  // Apply the saved theme on mount (the pre-paint script in index.html sets it
  // first to avoid a flash; this keeps it authoritative across client nav).
  React.useEffect(() => {
    applyTheme(getStoredPref());
  }, []);

  // Re-sync the active-game pointer on every navigation so the rejoin dock is
  // current (me.game is otherwise only fetched at app load). In the Activity,
  // wait for the bootstrap's bearer; the post-bootstrap navigate re-runs this.
  React.useEffect(() => {
    if (inActivityMode() && !getBearer()) return;
    void refresh();
  }, [pathname, refresh]);

  // One session-scoped websocket for the whole visit, kept across navigation so
  // the server treats a close as the site being shut (which guards lobby seats).
  // Torn down on logout, but not while auth is resolving: `me` is briefly null
  // on load, and disconnecting would drop the subscription a child route's
  // follow() just opened (effects run child first).
  React.useEffect(() => {
    if (loading) return;
    if (me) gameSocket.ensureOpen();
    else gameSocket.disconnect();
  }, [me?.id, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // The server rejected the session (see markSessionGone), so the socket stops
  // retrying. Re-ask who we are: the probe 401s, `me` goes null, the effect
  // above tears down the socket, and the app lands on sign-in like a logout.
  const sessionGone = useGameSocket((s) => s.sessionGone);
  React.useEffect(() => {
    if (sessionGone) void refresh();
  }, [sessionGone, refresh]);

  // Re-run on a language change, since the title descriptor is resolved here.
  // (The i18n instance is the same object across a change.)
  React.useEffect(() => {
    document.title = i18n._(title ?? DEFAULT_TITLE);
  }, [title, i18n, i18n.locale]);

  // The Activity bootstrap retries itself: `attempt` bumps on a capped,
  // jittered backoff and re-runs this effect while the Activity is open. The
  // error card stays up meanwhile.
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!inActivityMode()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    runActivityBootstrap()
      .then(async (result) => {
        if (cancelled) return;
        await refresh();
        void navigate(activityRoute(result));
        setErr(null);
        setBooting(false);
      })
      .catch((e) => {
        if (cancelled) return;
        // Never the raw error text (an ApiErr's message is its code); the
        // words come from lib/errorCopy.
        setErr(apiErrorText(e, t`The Activity couldn't reach the server.`));
        setBooting(false);
        // Exponential, capped and jittered like the socket's reconnect, so the
        // Activities in a call do not retry in lockstep.
        const wait = Math.min(1000 * 2 ** attempt, 30_000) * (0.5 + Math.random() / 2);
        timer = setTimeout(() => setAttempt((n) => n + 1), wait);
      });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (err) {
    return (
      <div className="min-h-full bg-background text-on-background flex items-center justify-center p-6">
        <div className="w-[min(88vw,400px)] rounded-card-lg border-2 border-border bg-secondary-background p-8 text-center shadow-[6px_6px_0_0_var(--border)]">
          <div className="text-[20px] font-extrabold mb-2">
            <Trans>Couldn't start the Activity</Trans>
          </div>
          <div className="text-[13px] text-muted mb-5 break-words">{err}</div>
          {/* No button: the retry runs on its own backoff (see the bootstrap
              effect). */}
          <div className="flex items-center justify-center gap-2 text-[13px] text-muted">
            <Spinner size={14} />
            <Trans>Trying again…</Trans>
          </div>
        </div>
      </div>
    );
  }
  if (booting) {
    return <LoadingScreen />;
  }
  const showDock = !!me?.game && !DOCK_HIDDEN.has(pathname);
  return (
    <RankedQueueProvider>
      <Outlet />
      {showDock && <GameDock gameId={me.game} />}
      <ConnectionIndicator />
    </RankedQueueProvider>
  );
}
