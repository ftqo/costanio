import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BrandPill } from "@/components/BrandPill";
import { DiscordIcon, GoogleIcon } from "@/components/ProviderIcons";
import { useAuth } from "@/lib/auth";
import { Trans } from "@lingui/react/macro";

const IS_DEV = import.meta.env.DEV;

export function Login() {
  const { me, devLogin } = useAuth();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (me && !me.guest) void navigate({ to: "/play" });
  }, [me, navigate]);

  return (
    <Screen center noFooter>
      <Card
        radius="lg"
        shadow="lg"
        className="w-95 max-w-[calc(100vw-32px)] px-7 py-8 max-sm:px-5 flex flex-col gap-3.5 my-16"
      >
        {/* The wordmark keeps its own round face; everything under it is the text face, and the title the display face. */}
        <BrandPill className="self-center font-wordmark text-[20px] font-extrabold tracking-[1px] text-foreground" />
        <h1 className="font-display text-[22px] font-heavy text-center leading-tight mb-1">
          <Trans>Log in</Trans>
        </h1>

        <a href="/auth/discord" className="w-full">
          <Button tone="discord" className="w-full" size="md">
            <DiscordIcon className="h-5 w-5" />
            <Trans>Continue with Discord</Trans>
          </Button>
        </a>

        <a href="/auth/google" className="w-full">
          <Button tone="google" className="w-full" size="md">
            <GoogleIcon className="h-5 w-5" />
            <Trans>Continue with Google</Trans>
          </Button>
        </a>

        <div className="text-[13px] text-muted text-center leading-relaxed mt-1">
          <Trans>
            No account needed to play, just open a table or follow an invite link, and set your name
            once you're seated. Log in with Discord or Google to keep your stats, friends, and a
            default name and color.
          </Trans>
        </div>

        {/* Dev-only affordance, not player-facing copy: left in English. */}
        {IS_DEV && (
          <Button onClick={devLogin} variant="quiet" size="sm" className="self-center">
            Dev login (Tester)
          </Button>
        )}

        <div className="text-[11px] text-muted text-center leading-snug border-t border-line pt-3.5">
          <Trans>Not affiliated with or endorsed by Catan GmbH / Catan Studio / Asmodee.</Trans>
        </div>
      </Card>
    </Screen>
  );
}
