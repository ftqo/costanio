import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trophy } from "@/lib/icons";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { SiteHeader, avatarColor } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { Skeleton } from "@/components/ui/skeleton";
import { RatingBadge } from "@/components/RatingBadge";
import { DecoratedName } from "@/components/DecoratedName";
import { Avatar } from "@/components/ui/avatar";
import { TrackTabs } from "@/components/TrackTabs";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

// The ranked queues only: they are the rulesets that carry a rating (see
// RANKED_RULESETS in lib/rating.ts and ranked/rulesets.go). Labels are
// descriptors because this table is built once at import.
const RULESETS: { label: MessageDescriptor; key: string }[] = [
  { label: msg({ message: "Base", context: "ruleset name" }), key: "base" },
  { label: msg({ message: "Knights", context: "ruleset name" }), key: "base+cak" },
];

const MEDAL = ["bg-yellow", "bg-silver", "bg-bronze"];

export function Leaderboard() {
  const { t, i18n } = useLingui();
  const [ruleset, setRuleset] = React.useState(RULESETS[0]);
  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", ruleset.key],
    queryFn: () => api.leaderboard(ruleset.key),
  });
  const rows = data?.entries ?? [];
  // Named once so the sentence and the loading label interpolate the same
  // value.
  const rulesetLabel = i18n._(ruleset.label);

  return (
    <Screen>
      <SiteHeader active="leaderboard" compact />

      <PageBody>
        {/* The bright amber on the trophy, not amber-ink: -ink is for light card
          surfaces and measures 1.03:1 on the ocean. Base amber is 3.57 in light
          and 11.03 in dark, clearing the non-text floor on both. */}
        <PageTitle
          icon={<Trophy weight="bold" size={26} className="text-amber" />}
          title={<Trans context="page title of the standings table">Leaderboard</Trans>}
          subtitle={<Trans>ELO-style rating per ruleset</Trans>}
        />

        {/* The track look every toggle group shares: a flat well, the chosen
            ruleset as the yellow tile. Wraps on a phone. */}
        <TrackTabs
          className="self-start"
          options={RULESETS.map((r) => ({ label: i18n._(r.label), value: r.key }))}
          value={ruleset.key}
          onChange={(key) => setRuleset(RULESETS.find((r) => r.key === key)!)}
        />

        {/* Table and footnote together: the footnote sits at mt-3, not the page
            gap. */}
        <div>
          <Card className="overflow-hidden">
            {/* Caps come from CSS, not the source text, so they translate and a
                locale where uppercasing is wrong (CJK) can turn it off. See the
                :lang() block in index.css. */}
            <div className="flex items-center gap-3 px-5 max-sm:px-3 py-2.5 border-b border-line text-[12px] font-semibold text-muted">
              <div className="w-8 text-center">#</div>
              <div className="flex-1">
                <Trans context="leaderboard column header">Player</Trans>
              </div>
              <div className="w-20 text-right max-sm:hidden">
                <Trans context="leaderboard column header, games played">Games</Trans>
              </div>
              {/* w-20, not w-16: translated headers (Spanish `% victorias`,
                  Turkish `Galibiyet %`) did not fit 64px. Matches the Rating
                  column. */}
              <div className="w-20 text-right">
                <Trans context="leaderboard column header, percentage of games won">Win %</Trans>
              </div>
              <div className="w-20 text-right">
                <Trans context="leaderboard column header, a player's ELO">Rating</Trans>
              </div>
            </div>
            {isLoading && (
              <div role="status" aria-label={t`Loading ${rulesetLabel} leaderboard`}>
                <span className="sr-only">
                  <Trans>Loading leaderboard…</Trans>
                </span>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    aria-hidden
                    className={cn(
                      "flex items-center gap-3 px-5 max-sm:px-3 py-3",
                      i < 7 && "border-b border-line",
                    )}
                  >
                    <div className="w-8 flex justify-center">
                      <Skeleton className="w-6 h-6 rounded-full" />
                    </div>
                    <Skeleton className="w-8.5 h-8.5 rounded-full shrink-0" />
                    <div className="flex-1">
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                    <div className="w-20 flex justify-end max-sm:hidden">
                      <Skeleton className="h-3.5 w-8" />
                    </div>
                    <div className="w-20 flex justify-end">
                      <Skeleton className="h-3.5 w-9" />
                    </div>
                    <div className="w-20 flex justify-end">
                      <Skeleton className="h-6 w-14 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!isLoading && rows.length === 0 && (
              <div className="text-center text-[14px] text-muted py-10">
                <Trans>No ranked games for {rulesetLabel} yet.</Trans>
              </div>
            )}
            {rows.map((row, i) => (
              <div
                key={row.user_id}
                className={cn(
                  "flex items-center gap-3 px-5 max-sm:px-3 py-3",
                  i < rows.length - 1 && "border-b border-line",
                )}
              >
                <div className="w-8 flex justify-center">
                  {i < 3 ? (
                    <span
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold font-num tabular-nums text-ink",
                        MEDAL[i],
                      )}
                    >
                      {i + 1}
                    </span>
                  ) : (
                    <span className="text-[13px] font-medium font-num tabular-nums text-muted">
                      {i + 1}
                    </span>
                  )}
                </div>
                <Avatar
                  color={avatarColor(row.user_id)}
                  src={row.avatar || undefined}
                  name={row.name}
                  size={34}
                  ring={2}
                />
                <div className="flex-1 min-w-0 truncate text-[15px] font-semibold flex items-center gap-1.5">
                  <DecoratedName decoration={row.decoration}>{row.name}</DecoratedName>
                </div>
                <div className="w-20 text-right text-[14px] font-num tabular-nums text-muted max-sm:hidden">
                  {row.games}
                </div>
                <div className="w-20 text-right text-[14px] font-semibold font-num tabular-nums">
                  {row.games ? Math.round((row.wins / row.games) * 100) : 0}%
                </div>
                <div className="w-20 flex justify-end">
                  <RatingBadge
                    elo={row.elo}
                    games={row.games}
                    provisional={row.provisional}
                    size="lg"
                  />
                </div>
              </div>
            ))}
          </Card>
          <div className="text-[13px] text-on-background-muted mt-3">
            <Trans>
              Leaderboard updates every 24 hours ·{" "}
              <Link
                to="/play"
                className="text-on-background font-semibold underline-offset-2 hover:underline"
              >
                find a table →
              </Link>
            </Trans>
          </div>
        </div>
      </PageBody>
    </Screen>
  );
}
