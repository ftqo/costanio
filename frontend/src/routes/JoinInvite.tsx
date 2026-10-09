import * as React from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { Spinner } from "@/components/ui/spinner";
import { api, ApiErr } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAbandonGuard } from "@/components/AbandonGuard";
import { Trans } from "@lingui/react/macro";

// Opening a shared invite link (/g/<code>): resolve the code, ensure a session
// (minting an anonymous guest if needed; the one place guest-minting belongs),
// join by code, and go to the waiting room.
export function JoinInvite() {
  const { code } = useParams({ strict: false });
  const { ensureSession } = useAuth();
  const navigate = useNavigate();
  const guard = useAbandonGuard();
  // The failure is held as a kind, not a sentence, so the words are chosen at
  // render and follow a language change.
  const [err, setErr] = React.useState<"no-such-table" | "join-failed" | null>(null);
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (ranRef.current || !code) return;
    ranRef.current = true;
    void (async () => {
      try {
        await ensureSession();
        const sum = await api.invite(code);
        if (!(await guard(sum.game.id))) {
          void navigate({ to: "/", replace: true });
          return;
        }
        try {
          await api.join(sum.game.id, code);
        } catch {
          /* already seated is fine */
        }
        void navigate({ to: "/lobby", search: { g: sum.game.id }, replace: true });
      } catch (e) {
        setErr(e instanceof ApiErr && e.status === 404 ? "no-such-table" : "join-failed");
      }
    })();
  }, [code, ensureSession, navigate, guard]);

  return (
    <Screen noFooter>
      <SiteHeader compact />
      <div
        role="status"
        aria-live="polite"
        /* On the page ground with no card: page ink, not card ink, since card
           grey is hard to read on the ocean. */
        className="flex flex-col items-center gap-3 pt-20 pb-5 text-[15px] text-on-background-muted"
      >
        {!err && <Spinner size={26} />}
        {err === "no-such-table" ? (
          <Trans>No table with that code.</Trans>
        ) : err === "join-failed" ? (
          <Trans>Could not join that table.</Trans>
        ) : (
          <Trans>Joining table…</Trans>
        )}
      </div>
      {err && (
        <div className="text-center pb-20">
          {/* blue-ink is for light surfaces and is 1.12:1 on the ocean;
              underlined page ink matches Landing's on-ground links. */}
          <Link
            to="/"
            className="text-on-background font-semibold text-[14px] underline underline-offset-2"
          >
            <Trans>Back to home</Trans>
          </Link>
        </div>
      )}
    </Screen>
  );
}
