import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { SiteHeader } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** The page for a URL no route claims: the site header plus one card that says
 * what happened and offers home (the filled action) and the rules. */
export function NotFound() {
  return (
    <Screen>
      <SiteHeader compact />
      <div className="flex justify-center px-4 py-16 max-[520px]:py-10">
        <Card className="w-full max-w-115 px-7 py-7 flex flex-col gap-3 max-[520px]:px-5">
          <div className="text-[11px] font-semibold text-muted">
            <Trans>Error 404</Trans>
          </div>
          <h1 className="font-display text-[24px] font-heavy leading-tight tracking-[-0.01em]">
            <Trans>This page is not on the map</Trans>
          </h1>
          <p className="text-[14px] text-muted leading-relaxed">
            <Trans>
              The link may be old, or the address may have a typo. Nothing here has changed about
              your games or your account.
            </Trans>
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild size="sm">
              <Link to="/">
                <Trans>Back to home</Trans>
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to="/how-to-play">
                <Trans>How to play</Trans>
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
