import * as React from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  fetchUserMatches,
  fetchMatch,
  fetchReplay,
  getCachedMatch,
  replayFilename,
  type MatchSummary,
  type MatchRecord,
} from "@/lib/matches";
import { PostGameScoreboard } from "@/components/game/PostGameScoreboard";
import { rulesetCaps } from "@/lib/caps";
import { rulesetTags } from "@/lib/format";
import { seatColor } from "@/lib/hexgeo";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CaretDown, DownloadSimple, Play, ShieldCheck } from "@/lib/icons";
import { formatDate } from "@/lib/intl";
import { apiErrorText } from "@/lib/errorCopy";

const PAGE_SIZE = 20;

// `MatchDetail` fetches and renders a full scoreboard for one game. The
// module-level matchCache in matches.ts fetches each game at most once, and
// getCachedMatch initialises state synchronously on re-expansion, so there is
// no spinner flash.
function MatchDetail({ gameId }: { gameId: string }) {
  const { t } = useLingui();
  const [rec, setRec] = React.useState<MatchRecord | null>(() => getCachedMatch(gameId) ?? null);
  const [err, setErr] = React.useState<string | null>(null);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return; // already fetched for this gameId
    started.current = true;
    if (getCachedMatch(gameId)) {
      // Cache hit: state was already initialised synchronously; nothing to do.
      return;
    }
    fetchMatch(gameId)
      .then(setRec)
      .catch(() => setErr(t`Couldn't load match details.`));
    // `t` is omitted: it is only read on the failure path, and listing it would
    // refetch the match on a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (err) {
    return <div className="text-[13px] text-muted px-4 py-3">{err}</div>;
  }
  if (!rec) {
    return (
      <div role="status" className="flex items-center gap-2 text-[13px] text-muted px-4 py-3">
        <Spinner size={15} />
        <Trans>Loading…</Trans>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      {/* No target score or dice mode: a match record carries the ruleset and
          numbers, not the setup config, and both charts draw without them.
          `vp_track` is missing from older records and handled the same way. */}
      <PostGameScoreboard
        players={rec.scoreboard.players}
        winner={rec.scoreboard.winner}
        caps={rulesetCaps(rec.ruleset)}
        rolls={rec.scoreboard.rolls}
        vpTrack={rec.scoreboard.vp_track}
        seatName={(seat) => rec.seats.find((s) => s.seat === seat)?.name ?? t`Seat ${seat}`}
        colorOf={(seat) => rec.seats.find((s) => s.seat === seat)?.color || seatColor(seat)}
      />
    </div>
  );
}

/**
 * Opens the game on the replay page. A link, not a button, since it navigates
 * (middle-click and copy-link work, and replays get shared). It fetches
 * nothing; the replay page fetches its own frames.
 */
function WatchReplay({ gameId }: { gameId: string }) {
  const { t } = useLingui();
  return (
    <Link
      to="/replay"
      search={{ g: gameId }}
      // The row underneath is its own click target (expand/collapse), so this
      // keeps its click and opts back in to pointer events, like the download.
      onClick={(e) => e.stopPropagation()}
      title={t`Watch this game back, move by move`}
      aria-label={t`Watch replay`}
      className="pointer-events-auto shrink-0 grid place-items-center size-8 max-sm:size-7 rounded-base text-muted hover:text-foreground hover:bg-elev2 transition-colors"
    >
      <Play size={15} weight="fill" />
    </Link>
  );
}

/**
 * Opens the fairness audit for this game. On the row beside Watch, since the
 * game to check is one you can already see. It navigates and fetches nothing.
 */
function VerifyGame({ gameId }: { gameId: string }) {
  const { t } = useLingui();
  return (
    <Link
      to="/verify"
      search={{ g: gameId }}
      // The row underneath is its own click target (expand/collapse), so this
      // keeps its click, like the icons either side.
      onClick={(e) => e.stopPropagation()}
      title={t`Check this game against the seed we committed to`}
      aria-label={t`Verify this game`}
      className="pointer-events-auto shrink-0 grid place-items-center size-8 max-sm:size-7 rounded-base text-muted hover:text-foreground hover:bg-elev2 transition-colors"
    >
      <ShieldCheck size={15} weight="fill" />
    </Link>
  );
}

/**
 * Saves the game's whole event log to a file: every move in order with the
 * dice seed, which replays to the identical state, so it is what a bug report
 * needs.
 *
 * An icon on the row rather than in the expanded detail, so getting the log
 * doesn't first fetch the scoreboard. Fetched on click, never on render: a log
 * is the largest thing this page can request.
 */
function ReplayDownload({ gameId }: { gameId: string }) {
  const { t } = useLingui();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const replay = await fetchReplay(gameId);
      // Pretty-printed, one event per line, since people read these as often as
      // programs do.
      const blob = new Blob([JSON.stringify(replay, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = replayFilename(gameId);
      a.click();
      // Revoked on the next tick: the click is synchronous but the browser's
      // fetch of the blob isn't, and revoking early can download nothing.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      // Keyed off the server's code so the refusal a player can provoke reads as
      // "wait a moment": the event log is metered for everyone, and this pulls a
      // whole log per click (see docs/protocol.md, Metering the log).
      setErr(apiErrorText(e, t`Couldn't download the replay.`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      // The row underneath is a click target (expand/collapse), so this keeps
      // its click, and opts back in to pointer events, which the content layer
      // turns off so clicks reach the row.
      onClick={(e) => {
        e.stopPropagation();
        void save();
      }}
      title={err ?? t`Download every move of this game as JSON`}
      aria-label={err ?? t`Download replay`}
      className="pointer-events-auto shrink-0 grid place-items-center size-8 max-sm:size-7 rounded-base bg-transparent border-0 cursor-pointer text-muted hover:text-foreground hover:bg-elev2 disabled:opacity-50 disabled:cursor-default transition-colors"
    >
      {busy ? (
        <Spinner size={13} />
      ) : (
        // Red once it has failed; the title and label carry the reason.
        <DownloadSimple size={15} weight="bold" className={err ? "text-red-ink" : undefined} />
      )}
    </button>
  );
}

// A single summary row in the match list.
function MatchRow({
  match,
  userId,
  expanded,
  onToggle,
}: {
  match: MatchSummary;
  userId: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLingui();
  // Find the profile user's seat
  const myPlayer = match.players.find((p) => p.user_id === userId);
  // A finished game can have no winner (an agreed draw, or a claim against bots
  // with nobody ahead). That is neither a win nor a loss.
  const drawn = match.winner < 0;
  const didWin = !drawn && myPlayer?.seat === match.winner;
  const tags = rulesetTags(match.ruleset);

  return (
    <div className="border-t border-line first:border-0">
      {/* Summary row, clickable to toggle detail. The toggle is a real button
          laid under the row rather than around it, since the row holds buttons
          of its own and buttons can't nest. The content above passes clicks
          through; only its own buttons take them back. */}
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          // Inset from the card's sides so the hover fill never paints over
          // the panel's keyline.
          className="absolute inset-y-0 inset-x-0.5 cursor-pointer hover:bg-elev transition-colors bg-transparent border-0"
        >
          <span className="sr-only">
            {expanded ? t`Hide match details` : t`Show match details`}
          </span>
        </button>
        {/* Not aria-hidden: it holds the download button, and a focusable
            control inside an aria-hidden subtree is unreachable and invalid. */}
        <div className="relative pointer-events-none text-left pl-5 pr-3 max-sm:pl-4 max-sm:pr-2 py-2.5 flex flex-wrap items-center gap-x-3 max-sm:gap-x-2 gap-y-1.5">
          {/* The result leads the row, since it is what a list of your games is
              scanned for. A fixed minimum so the column lines up. */}
          {myPlayer && (
            // Caps from CSS, so the words stay translatable and CJK locales can
            // turn it off (see the :lang() block in index.css).
            // A result chip: Win green, Loss navy, Draw grey (pb-site.css
            // draws the three fills from `data-result`).
            <span
              data-result={drawn ? "draw" : didWin ? "win" : "loss"}
              className={cn(
                "text-[12px] font-bold min-w-12 shrink-0 text-center rounded-md px-1.5 py-0.5",
                drawn
                  ? "bg-elev2 text-foreground"
                  : didWin
                    ? "bg-btn-primary text-btn-primary-ink"
                    : "bg-foreground text-secondary-background",
              )}
            >
              {drawn ? (
                <Trans context="result of a finished game: nobody won">Draw</Trans>
              ) : didWin ? (
                <Trans context="result of a finished game: you won">Win</Trans>
              ) : (
                <Trans context="result of a finished game: you lost">Loss</Trans>
              )}
            </span>
          )}

          {/* Ruleset chips */}
          <div className="flex items-center gap-1.5 shrink-0">
            {tags.map((tag) => (
              // One neutral print tag for every ruleset: a rainbow of fills
              // read as status, and the lighter hues lost contrast in dark.
              <Badge key={tag.label} tone="rating" size="xs">
                {tag.label}
              </Badge>
            ))}
          </div>

          {/* Who was at the table and their final score, in seat colour; the
              winner in a heavier weight. Hidden on a phone, where the row only
              has room for the result, date and actions. */}
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-3 gap-y-1 max-sm:hidden">
            {[...match.players]
              .sort((a, b) => b.vp - a.vp)
              .map((p) => (
                <span
                  key={p.seat}
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[13px] whitespace-nowrap",
                    p.seat === match.winner ? "font-semibold text-foreground" : "text-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full shrink-0 bg-(--swatch)"
                    style={{ "--swatch": p.color || seatColor(p.seat) } as React.CSSProperties}
                  />
                  {p.name}
                  <span className="font-num tabular-nums text-muted font-normal">{p.vp}</span>
                </span>
              ))}
          </div>
          <div className="flex-1 sm:hidden" />

          {/* Date, with the actions beside it: watch, check, or keep. */}
          <span className="text-[13px] text-muted font-num tabular-nums shrink-0">
            {formatDate(match.finished_at * 1000)}
          </span>
          <div className="flex items-center shrink-0">
            <WatchReplay gameId={match.game_id} />
            <VerifyGame gameId={match.game_id} />
            <ReplayDownload gameId={match.game_id} />
            {/* Expand/collapse indicator */}
            <span
              aria-hidden
              className="grid place-items-center size-8 text-muted shrink-0 max-sm:hidden"
            >
              <CaretDown
                size={14}
                weight="bold"
                className={cn("transition-transform", expanded && "rotate-180")}
              />
            </span>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {expanded && (
        // Inset inside the card, a flat well, so it never covers the panel's
        // keyline.
        <div className="mx-2 mb-2 rounded-base bg-elev">
          <MatchDetail gameId={match.game_id} />
        </div>
      )}
    </div>
  );
}

export function MatchHistory({ userId }: { userId: number }) {
  const { t } = useLingui();
  const [matches, setMatches] = React.useState<MatchSummary[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [hasMore, setHasMore] = React.useState(true);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  // Initial load
  React.useEffect(() => {
    setLoading(true);
    setErr(null);
    fetchUserMatches(userId)
      .then((rows) => {
        setMatches(rows);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .catch(() => setErr(t`Couldn't load match history.`))
      .finally(() => setLoading(false));
    // `t` is omitted: it is only read on the failure path, and listing it would
    // reload the history on a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const loadMore = async () => {
    if (matches.length === 0) return;
    const oldest = matches[matches.length - 1];
    setLoadingMore(true);
    try {
      const rows = await fetchUserMatches(userId, oldest.finished_at);
      setMatches((prev) => [...prev, ...rows]);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch {
      setErr(t`Couldn't load more matches.`);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleExpand = (gameId: string) => {
    setExpanded((prev) => (prev === gameId ? null : gameId));
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-4.5 pb-3 border-b border-line">
        <h2 className="font-display text-[17px] font-semibold leading-snug">
          <Trans>Match history</Trans>
        </h2>
      </div>

      {loading && (
        <div role="status" className="flex items-center gap-2 text-[14px] text-muted px-5 py-4">
          <Spinner size={16} />
          <Trans>Loading…</Trans>
        </div>
      )}

      {err && !loading && <div className="text-[14px] text-muted px-5 py-4">{err}</div>}

      {!loading && !err && matches.length === 0 && (
        <div className="text-[14px] text-muted px-5 py-4">
          <Trans>No matches yet.</Trans>
        </div>
      )}

      {!loading && matches.length > 0 && (
        <div className="flex flex-col">
          {matches.map((m) => (
            <MatchRow
              key={m.game_id}
              match={m}
              userId={userId}
              expanded={expanded === m.game_id}
              onToggle={() => toggleExpand(m.game_id)}
            />
          ))}
        </div>
      )}

      {!loading && hasMore && matches.length > 0 && (
        <div className="px-5 py-3 border-t border-line">
          <Button
            variant="secondary"
            size="sm"
            disabled={loadingMore}
            onClick={() => {
              void loadMore();
            }}
          >
            {loadingMore ? <Trans>Loading…</Trans> : <Trans>Load more</Trans>}
          </Button>
        </div>
      )}
    </Card>
  );
}
