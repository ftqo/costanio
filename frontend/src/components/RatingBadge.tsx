import { useLingui } from "@lingui/react/macro";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Tip } from "@/components/game/Tip";
import { rulesetLabel } from "@/lib/format";
import { isProvisional } from "@/lib/rating";

// RatingBadge renders a raw Elo number (no tiers). A provisional rating (few
// games) is muted with a trailing `?`. An optional ruleset label says which
// ruleset a "highest across rulesets" number is from (e.g. "1240 · Islands").
export function RatingBadge({
  elo,
  games,
  provisional,
  ruleset,
  size,
  className,
}: {
  elo: number;
  games?: number;
  provisional?: boolean;
  ruleset?: string;
  /** The row's badge size, so a rating sits level with the badges beside it. */
  size?: BadgeProps["size"];
  className?: string;
}) {
  const { t } = useLingui();
  const prov = provisional ?? isProvisional(games ?? 0);
  const badge = (
    <Badge tone="rating" size={size} dim={prov} className={className}>
      {Math.round(elo)}
      {prov ? "?" : ""}
      {ruleset ? ` · ${rulesetLabel(ruleset)}` : ""}
    </Badge>
  );
  if (!prov) return badge;
  return (
    <Tip
      tapToOpen
      title={t`Provisional rating`}
      hint={t`Fewer than 10 rated games, still settling.`}
    >
      {badge}
    </Tip>
  );
}
