import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trans, useLingui } from "@lingui/react/macro";
import { SiteHeader } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { Button, buttonLook } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ReplayPlayer, type ReplaySeat } from "@/components/replay/ReplayPlayer";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { useAuth } from "@/lib/auth";
import { fetchMatch, fetchUserMatches, type MatchSummary } from "@/lib/matches";
import { rulesetTags } from "@/lib/format";
import { formatDate } from "@/lib/intl";
import type { ReplaySource } from "@/lib/replay/types";
import { FilmStrip, UploadSimple } from "@/lib/icons";

/**
 * The replay page. `/replay?g=<id>` is a game the server still holds, linked
 * from the history list and from each row of a profile's match history.
 * `/replay` with no game lets a player pick one of their games or open a
 * file: the JSON log a history row downloads, which also works for a game this
 * server has never seen, so a bug report is reproducible by whoever receives
 * it.
 *
 * The fold is the server's either way (see the `replay` Go package); the page
 * holds frames and only selects between them.
 */
export function Replay() {
  const { me, ensureSession } = useAuth();
  const navigate = useNavigate();
  const { t } = useLingui();
  // `?g=<id>`, the same key /game and /lobby use, validated in one place (see
  // `gameSearch`). `inv` rides alongside as on /game, so a spectator who
  // reached a private table by link does not get a 403 here.
  const { g: gameId, inv: invite } = useSearch({ strict: false });

  // A file the viewer opened. Held here rather than in the URL: it does not
  // exist on the server.
  const [file, setFile] = React.useState<{
    source: ReplaySource;
    name: string;
  } | null>(null);

  const stored = useQuery({
    // The invite is part of the key: the same game id with and without a code
    // are different answers (one a 403).
    queryKey: ["replay", "frames", gameId, invite ?? ""],
    queryFn: () => api.gameFrames(gameId!, invite),
    enabled: !!gameId,
    retry: false,
    // A finished game's frames never change, so nothing needs refetching.
    staleTime: Infinity,
    // But it is not kept forever: a folded game is the largest object the app
    // holds. Five minutes covers going back for a second look.
    gcTime: 5 * 60 * 1000,
  });
  // The roster, for names and colours. Optional: the frames are watchable
  // without it, so a failure only costs numbered seats.
  const roster = useQuery({
    queryKey: ["match", gameId],
    queryFn: () => fetchMatch(gameId!),
    enabled: !!gameId,
    retry: false,
    staleTime: Infinity,
  });

  if (gameId && stored.isPending) {
    return <Loading />;
  }
  if (gameId && stored.error) {
    return (
      <Problem
        message={apiErrorText(stored.error, t`Could not load that replay.`)}
        onBack={() => void navigate({ to: "/replay" })}
      />
    );
  }

  const source = file?.source ?? stored.data;
  if (source) {
    const seats: ReplaySeat[] | undefined = roster.data?.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      color: s.color,
    }));
    return (
      <ReplayPlayer
        source={source}
        seats={file ? undefined : seats}
        title={
          <ReplayTitle
            source={source}
            fileName={file?.name}
            onLeave={() => {
              setFile(null);
              void navigate({ to: "/replay" });
            }}
          />
        }
      />
    );
  }

  return (
    <Chooser
      me={me}
      onOpened={(source, name) => setFile({ source, name })}
      ensureSession={ensureSession}
    />
  );
}

function Loading() {
  return (
    <Screen center>
      <Spinner />
    </Screen>
  );
}

function Problem({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <Screen center>
      <div className="flex flex-col items-center gap-4 text-center px-6">
        <div className="text-[15px] font-semibold text-on-background">{message}</div>
        <Button variant="secondary" onClick={onBack}>
          <Trans>Pick another replay</Trans>
        </Button>
      </div>
    </Screen>
  );
}

/** The heading above the controls: which game, and the audit trail if it has one. */
function ReplayTitle({
  source,
  fileName,
  onLeave,
}: {
  source: ReplaySource;
  fileName?: string;
  onLeave: () => void;
}) {
  const { meta } = source;
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-foreground truncate">
          {fileName ?? <Trans>Replay</Trans>}
        </div>
        <div className="mt-1 font-num text-[11px] text-muted tabular-nums flex flex-wrap gap-x-2.5">
          <span>
            {rulesetTags(meta.ruleset)
              .map((tag) => tag.label)
              .join(" ")}
          </span>
          <span>
            <Trans>{meta.players} players</Trans>
          </span>
          {/* The seed, when the log carries one: a player at this table was
              shown a commitment to it before the first roll, and checks it here
              (docs/dice.md). A spectator's copy has it stripped, and then this
              shows nothing rather than zero. */}
          {meta.seed !== undefined && (
            <span title="seed">
              <Trans>Seed: {meta.seed}</Trans>
            </span>
          )}
        </div>
      </div>
      <Button size="sm" variant="secondary" className="ml-auto shrink-0" onClick={onLeave}>
        <Trans context="leave the replay being watched">Close</Trans>
      </Button>
    </div>
  );
}

/** The front door: your own games, or a file. */
function Chooser({
  me,
  onOpened,
  ensureSession,
}: {
  me: ReturnType<typeof useAuth>["me"];
  onOpened: (source: ReplaySource, name: string) => void;
  ensureSession: () => Promise<unknown>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const matches = useQuery({
    queryKey: ["matches", me?.id],
    queryFn: () => fetchUserMatches(me!.id),
    enabled: !!me,
  });

  async function open(f: File) {
    setErr(null);
    setBusy(true);
    try {
      const text = await f.text();
      const parsed: unknown = JSON.parse(text);
      const body = parsed as { game?: string; events?: unknown[] };
      if (!Array.isArray(body.events)) {
        setErr(t`That file is not a replay.`);
        return;
      }
      // The fold is the server's; the client would otherwise be a second rules
      // engine. The upload endpoint needs a session, so a first-time visitor
      // gets a guest one here, as other protected actions do. A file that is
      // not a replay is refused above without one.
      await ensureSession();
      const source = await api.foldReplay({ game: body.game, events: body.events });
      onOpened(source, f.name);
    } catch (e) {
      setErr(
        e instanceof SyntaxError
          ? t`That file is not a replay.`
          : apiErrorText(e, t`Could not open that replay.`),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <SiteHeader active="replay" compact />
      <PageBody>
        <PageTitle
          icon={<FilmStrip size={26} weight="bold" />}
          title={<Trans>Replays</Trans>}
          subtitle={<Trans>Watch a finished game back, move by move.</Trans>}
        />

        <Card className="p-5 flex flex-col gap-3">
          <h2 className="font-display text-[17px] font-semibold">
            <Trans>Open a replay file</Trans>
          </h2>
          <div className="text-[14px] leading-relaxed text-muted">
            <Trans>
              Any replay you have downloaded, from any game, including one somebody sent you.
            </Trans>
          </div>
          <label className="self-start">
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                // Cleared so picking the same file again re-opens it: the change
                // event does not fire for an unchanged value.
                e.target.value = "";
                if (f) void open(f);
              }}
            />
            <span {...buttonLook({ variant: "secondary", size: "sm" })}>
              {busy ? <Spinner size={16} /> : <UploadSimple size={16} weight="bold" />}
              <Trans context="open a replay file from disk">Choose a file</Trans>
            </span>
          </label>
          {err && <div className="text-[13px] font-semibold text-red-ink">{err}</div>}
        </Card>

        <h2 className="mt-2 font-display text-[17px] font-semibold text-on-background">
          <Trans>Your games</Trans>
        </h2>
        {!me ? (
          <div className="text-[14px] text-on-background-muted">
            <Trans>Log in to see the games you have played.</Trans>
          </div>
        ) : matches.isPending ? (
          <div>
            <Spinner />
          </div>
        ) : matches.data?.length ? (
          <Card className="overflow-hidden">
            <div className="flex flex-col divide-y divide-line">
              {matches.data.map((m) => (
                <HistoryRow key={m.game_id} match={m} />
              ))}
            </div>
          </Card>
        ) : (
          <div className="text-[14px] text-on-background-muted">
            <Trans>No finished games yet. Play one and it will be here.</Trans>
          </div>
        )}
      </PageBody>
    </Screen>
  );
}

function HistoryRow({ match }: { match: MatchSummary }) {
  const winner = match.players.find((p) => p.seat === match.winner);
  return (
    <div className="px-5 py-3 flex items-center gap-x-3.5 gap-y-2 flex-wrap max-sm:px-4">
      <div className="flex-1 min-w-[12rem]">
        <div className="text-[14px] font-semibold truncate">
          {winner ? (
            <Trans>{winner.name} won</Trans>
          ) : (
            <Trans context="a finished game nobody won">Drawn game</Trans>
          )}
        </div>
        <div className="mt-0.5 font-num text-[11px] text-muted tabular-nums whitespace-nowrap">
          {formatDate(match.finished_at * 1000)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {rulesetTags(match.ruleset).map((tag) => (
            <Badge
              key={tag.label}
              // One neutral print tag for every ruleset (no rainbow).
              tone="rating"
              size="xs"
            >
              {tag.label}
            </Badge>
          ))}
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link to="/replay" search={{ g: match.game_id }}>
            <Trans context="watch a replay of this game">Watch</Trans>
          </Link>
        </Button>
        {/* The fairness audit for this game, beside Watch: it checks the roll
          you remember against the seed committed before the table opened. */}
        <Button asChild size="sm" variant="secondary">
          <Link to="/verify" search={{ g: match.game_id }}>
            <Trans context="check this game was not rigged">Verify</Trans>
          </Link>
        </Button>
      </div>
    </div>
  );
}
