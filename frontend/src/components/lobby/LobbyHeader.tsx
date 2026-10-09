import type * as React from "react";
import { Trans } from "@lingui/react/macro";
import { BrandPill } from "@/components/BrandPill";
import { HamburgerMenu } from "@/components/SiteHeader";
import { LanguagePicker } from "@/components/LanguagePicker";

/**
 * The waiting room's header, in its two layouts. Every cluster is a node the
 * route passes in, so a test or browser harness can render the real markup at a
 * real width without a session, socket or table.
 */
export function LobbyHeader({
  host,
  seatButtons,
  privacyControl,
  inviteControls,
  profileMenu,
}: {
  host: string;
  seatButtons: React.ReactNode;
  privacyControl: React.ReactNode;
  inviteControls: React.ReactNode;
  profileMenu: React.ReactNode;
}) {
  return (
    <>
      {/* Mobile header (<720px): hamburger top-left, "{host}'s table" centered,
          invite controls right; the seat actions sit on a second row. */}
      <div className="min-[720px]:hidden squat:flex! flex flex-col gap-2 px-3 pt-3.5 shrink-0">
        <div className="relative flex items-center gap-2 min-h-9">
          <HamburgerMenu />
          {/* Centred by its flex row, not absolutely positioned: absolute
              centring can't see where the right cluster begins and ran under
              the language picker on phones. As a flex item it gets the gap
              between the hamburger and the cluster and truncates there, as the
              desktop header does. */}
          <div className="min-w-0 flex-1 text-center font-display text-[18px] font-heavy text-on-background truncate">
            <Trans>{host}'s table</Trans>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {/* First in the cluster in both layouts (left of "Show code" on
              desktop, left of the kebab on a phone, never inside it): a
              signed-out visitor has no profile menu here, so this is the only
              way to change language. The panel hangs from the trigger's right
              edge (`align="end"`), opening leftward into the empty middle of the
              header rather than under the buttons to its right. */}
            <LanguagePicker />
            {inviteControls}
            {profileMenu}
          </div>
        </div>
        {/* Privacy is on the seat row, not the title row: the title row is
            already three clusters wide on a phone, and this is an action on the
            table like the seat buttons. */}
        <div className="flex items-center gap-2 flex-wrap">
          {privacyControl}
          {seatButtons}
        </div>
      </div>

      {/* Desktop header (>=720px): brand pill + seat controls left, table
          chrome right, the table's name between them.

          It wraps rather than trusting a width. Neither cluster can usefully
          shrink, so the row is `flex-wrap` with both clusters `shrink-0`: when
          they don't fit, the right one takes a second line. The page root is
          `overflow-x-hidden`, so overflow would make controls unreachable, and
          the profile menu (the Activity's only route to the store) is last in
          the row. A higher breakpoint would only move the problem to the next
          control added.

          The title is a truncating flex item, never absolutely centred
          (absolute centring ran under the right cluster from 940px to about
          1220px). Its 8rem floor matters: with `min-w-0` alone it gets 20px at
          940px, an ellipsis and one letter. A title that can't have 8rem takes
          its own line, and the row returns to one line once both fit. */}
      <div className="hidden min-[720px]:flex squat:hidden! flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-3.5 shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <BrandPill className="shrink-0 font-wordmark font-[800] text-on-background text-[20px] leading-none tracking-[1px] px-1 py-1.5 mr-1 rounded-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {seatButtons}
        </div>
        <div className="min-w-[8rem] flex-1 truncate text-center font-display text-[22px] font-heavy tracking-[-0.01em] text-on-background">
          <Trans>{host}'s table</Trans>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <LanguagePicker />
          {privacyControl}
          {inviteControls}
          {profileMenu}
        </div>
      </div>
    </>
  );
}
