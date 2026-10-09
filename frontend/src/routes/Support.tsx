import type { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import { Screen } from "@/components/Screen";
import { Card } from "@/components/ui/card";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { Heart } from "@/lib/icons";
import { SiteHeader } from "@/components/SiteHeader";
import { DecoratedName } from "@/components/DecoratedName";
import { Button } from "@/components/ui/button";
import { DISCORD_INVITE_URL } from "@/lib/links";

// External destinations.
const DISCORD_URL = DISCORD_INVITE_URL;
const KOFI_URL = "https://ko-fi.com/ftqoo";

/**
 * The three promises, as their own messages. Keyed by a stable id, not the
 * English text, so a language change does not remount every chip.
 */
const PRINCIPLES: { id: string; text: ReactNode }[] = [
  { id: "no-loot", text: <Trans>No loot boxes or randomness</Trans> },
  { id: "no-p2w", text: <Trans>No pay-to-win, cosmetics never touch the game</Trans> },
  { id: "earned", text: <Trans>Earned currency, never sold</Trans> },
];

/** A section of the page: a heading, one quiet line on what it is, and a grid
 * of tiles. The tiles are wells inside the panel, not cards of their own. */
function Section({
  title,
  blurb,
  children,
}: {
  title: ReactNode;
  blurb: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="px-5 py-4.5 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[17px] font-semibold leading-tight">{title}</h2>
        <div className="text-[14px] text-muted">{blurb}</div>
      </div>
      {children}
    </Card>
  );
}

export function Support() {
  return (
    <Screen>
      <SiteHeader active="support" compact />

      <PageBody>
        <PageTitle
          icon={<Heart weight="fill" size={26} className="text-red" />}
          title={<Trans context="page title of the supporting page">Support</Trans>}
          subtitle={<Trans>Free forever. Supporting only buys cosmetics.</Trans>}
        />
        {/* The promise. */}
        <Card radius="lg" className="px-6 py-8 text-center">
          {/* One message, break included, so the translator decides where the
              line turns. */}
          <div className="font-display text-[24px] sm:text-[32px] font-heavy leading-[1.15] tracking-[-0.015em] text-balance">
            <Trans>
              Costanio is free. Forever.
              <br />
              And never pay-to-win.
            </Trans>
          </div>
          <div className="mt-3 text-[15px] leading-relaxed text-muted max-w-160 mx-auto">
            <Trans>
              Every rule, every mode, every game, free for everyone, always. Supporting only ever
              buys cosmetics and a warm feeling. It never buys an advantage.
            </Trans>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {PRINCIPLES.map((p) => (
              <span
                key={p.id}
                className="text-[12px] font-semibold text-muted bg-elev rounded-base px-2.5 py-1.5"
              >
                {p.text}
              </span>
            ))}
          </div>
        </Card>

        {/* Ways to support. */}
        <Section
          title={<Trans>Ways to support</Trans>}
          blurb={<Trans>All optional. Pick whatever fits, or just keep playing.</Trans>}
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2.5">
            <SupportCard
              title={<Trans context="Ko-fi subscription tier">Supporter ($4.99/mo on Ko-fi)</Trans>}
              body={
                <Trans>
                  Same perks either way, and the Ko-fi supporter role shows on Discord too, so you
                  are marked there without subscribing twice.
                </Trans>
              }
              cta={<Trans>Open Ko-fi</Trans>}
              href={KOFI_URL}
              live
            />
            <SupportCard
              title={
                <Trans context="Discord subscription tier">Supporter ($4.99/mo on Discord)</Trans>
              }
              body={
                <Trans>
                  Same perks, billed where the community already is. Boosting the server instead
                  grants a name effect (a nice extra, not supporter status).
                </Trans>
              }
              cta={<Trans>Open Discord</Trans>}
              href={DISCORD_URL}
              live
            />
          </div>
        </Section>

        {/* What you get. */}
        <Section
          title={<Trans>What supporting unlocks</Trans>}
          blurb={
            <Trans>All cosmetic, all optional. Manage everything in your account settings.</Trans>
          }
        >
          <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2.5">
            <Perk
              title={<Trans>The full 64-color palette</Trans>}
              body={<Trans>vs. the 10 free presets, for your seat color.</Trans>}
            />
            <Perk
              title={<Trans>+10,000 Pips / month</Trans>}
              body={<Trans>A recurring stipend, spendable on any cosmetic.</Trans>}
            />
            <div className="rounded-base px-3.5 py-3 bg-elev">
              <div className="text-[14px] font-semibold mb-2">
                <Trans>Name decorations</Trans>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[15px] font-semibold">
                <DecoratedName decoration="decoration.booster">
                  <Trans context="name decoration for a Discord server booster">Booster</Trans>
                </DecoratedName>
                <DecoratedName decoration="decoration.supporter">
                  <Trans context="name decoration for a Discord subscriber">Supporter</Trans>
                </DecoratedName>
                <DecoratedName decoration="decoration.kofi">Ko-fi</DecoratedName>
              </div>
              <div className="text-[12px] text-muted leading-snug mt-2">
                <Trans>
                  An animated sparkle behind your name, one per way you support: pink for boosting,
                  blue for Discord, yellow for Ko-fi.
                </Trans>
              </div>
            </div>
          </div>
        </Section>
      </PageBody>
    </Screen>
  );
}

function SupportCard({
  title,
  body,
  cta,
  href,
  live,
}: {
  title: ReactNode;
  body: ReactNode;
  cta: ReactNode;
  href?: string;
  live: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-base px-3.5 py-3 bg-elev">
      <div className="text-[14px] font-semibold">{title}</div>
      <div className="text-[13px] text-muted leading-snug flex-1">{body}</div>
      {/* Both secondary: two equal routes to the same thing, so neither takes
          the page's amber fill. */}
      {live && href ? (
        <Button asChild variant="secondary" size="sm" pill={false} className="w-full">
          <a href={href} target="_blank" rel="noreferrer">
            {cta}
          </a>
        </Button>
      ) : (
        <div className="text-[12px] font-semibold rounded-base px-2.5 py-1.5 bg-elev2 text-muted text-center">
          {cta}
        </div>
      )}
    </div>
  );
}

function Perk({ title, body }: { title: ReactNode; body: ReactNode }) {
  return (
    <div className="rounded-base px-3.5 py-3 bg-elev">
      <div className="text-[14px] font-semibold mb-1">{title}</div>
      <div className="text-[12px] text-muted leading-snug">{body}</div>
    </div>
  );
}
