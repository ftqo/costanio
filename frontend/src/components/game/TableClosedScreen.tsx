import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ActivitySafeLink } from "@/components/ActivitySafeLink";
import { Button, buttonLook } from "@/components/ui/button";
import { inActivityMode } from "@/lib/activity";

/**
 * Whether the table a `/game` link points at has closed for good, so no state
 * frame is coming and the entry screen must stop waiting.
 *
 * Two sources, since either can arrive first: the websocket answers a
 * subscription to an abandoned game with a `closed` lobby frame (server/ws.go,
 * the "abandoned" case) and no view, and the REST read carries
 * `status: "abandoned"`.
 *
 * Only meaningful with no view. A player at the board who is reset to the lobby
 * is handled by the reset handoff.
 */
export function tableClosed(sockClosed: boolean, status: string | undefined): boolean {
  return sockClosed || status === "abandoned";
}

/**
 * The page for a table that has closed, with the two ways on. The replay is
 * offered because an abandoned game's log is kept and replayable
 * (server/api.go `replayable`).
 */
export function TableClosedScreen({ g, inv }: { g: string; inv?: string }) {
  const { t } = useLingui();
  return (
    <LoadingScreen
      message={t`This table has closed, so there is no game to rejoin.`}
      actions={
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* The guard reads inActivityMode() at the site itself, which is the
              form lib/activityGuards.test.ts accepts as evidence. */}
          {!inActivityMode() && (
            <Button asChild variant="secondary">
              <Link to="/play">
                <Trans>Back to Play</Trans>
              </Link>
            </Button>
          )}
          <ActivitySafeLink>
            <Link {...buttonLook({ variant: "primary" })} to="/replay" search={{ g, inv }}>
              <Trans context="watch a replay of the game just finished">Watch replay</Trans>
            </Link>
          </ActivitySafeLink>
        </div>
      }
    />
  );
}
