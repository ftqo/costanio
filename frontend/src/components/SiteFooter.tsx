import { Link } from "@tanstack/react-router";
import { Trans } from "@lingui/react/macro";
import { DISCORD_INVITE_URL } from "@/lib/links";
import { inActivityMode } from "@/lib/activity";
import { cn } from "@/lib/utils";

/**
 * Full-width site footer. Rendered by Screen on content pages, and pinned over
 * the board on the homepage, which passes `rule={false}` and draws its own fade.
 */
export function SiteFooter({ rule = true }: { rule?: boolean }) {
  // Every link here (wordmark home, Discord, Terms, Privacy) escapes the
  // contained Discord Activity, so the footer never renders inside it.
  if (inActivityMode()) return null;
  return (
    // Narrower gutters on a small screen keep the row a row.
    // `--game-dock-h`: extra bottom padding so the floating rejoin dock can
    // scroll clear of the footer.
    // A hairline and quiet text on the page ground, no slab.
    <div
      className={cn(
        // Quiet text on the page ground, no slab and no hairline: the rule is
        // gone under Punchboard, so both variants draw the same transparent
        // 1px border and sit identically. `rule` is kept for callers.
        "mt-8 text-on-background-muted px-5 sm:px-10 pt-4 pb-[calc(1rem+var(--game-dock-h,0px))] flex flex-col gap-2 text-[13px] font-semibold border-t border-transparent",
        rule && "border-transparent",
      )}
    >
      {/* A row at every width; on a narrow phone it wraps and the copyright
          drops to a second line. */}
      <div className="flex flex-row flex-wrap items-center gap-x-4 sm:gap-x-5.5 gap-y-1">
        <Link
          to="/"
          className="font-wordmark text-[15px] leading-none tracking-[1px] text-on-background select-none"
        >
          COSTAN.IO
        </Link>
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noreferrer"
          className="hover:text-on-background transition-colors"
        >
          Discord
        </a>
        <Link to="/terms" className="hover:text-on-background transition-colors">
          <Trans context="footer link to the Terms of Service">Terms</Trans>
        </Link>
        <Link to="/privacy" className="hover:text-on-background transition-colors">
          <Trans context="footer link to the Privacy Policy">Privacy</Trans>
        </Link>
        {/* Pushed right only from `sm`; on a wrapped narrow row it stays
            inline. */}
        <span className="sm:ml-auto">© 2026 ftqo</span>
      </div>
      <div className="text-[12px] text-on-background-muted">
        <Trans>Not affiliated with or endorsed by Catan GmbH / Catan Studio / Asmodee.</Trans>
      </div>
    </div>
  );
}
