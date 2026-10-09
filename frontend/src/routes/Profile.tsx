import { Fragment, useState, useEffect, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader, avatarColor } from "@/components/SiteHeader";
import { DecoratedName } from "@/components/DecoratedName";
import { DiscordIcon, GoogleIcon } from "@/components/ProviderIcons";
import { RatingBadge } from "@/components/RatingBadge";
import { highestRankedRating, isRanked } from "@/lib/rating";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { api, ApiErr, type MergePreview } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm";
import { rulesetTags } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  SWATCH_LOCKED_CHIP,
  SWATCH_LOCKED_WELL,
  SWATCH_PICKED,
  swatchEdge,
} from "@/components/swatchLook";
import { formatNumber } from "@/lib/intl";
import { MatchHistory } from "@/components/profile/MatchHistory";

/**
 * Display name and default seat colour. The colour writes the loadout's
 * `color` slot, which seeds a fresh seat; the lobby's picker overrides it per
 * game. Supporter colours show as unavailable rather than hidden.
 */
function Appearance({ name: current, onSaved }: { name: string; onSaved: () => Promise<void> }) {
  const { t } = useLingui();
  const toast = useToast();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(current), [current]);

  const colorsQ = useQuery({ queryKey: ["colors"], queryFn: api.colors, staleTime: 60_000 });
  const loadoutQ = useQuery({ queryKey: ["loadout"], queryFn: api.loadout });
  const colors = colorsQ.data?.colors ?? [];
  const currentColor = loadoutQ.data?.loadout?.color ?? "";

  async function saveName() {
    const next = name.trim();
    if (!next || next === current) return;
    setBusy(true);
    try {
      await api.updateMe(next);
      await onSaved();
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not save name`));
    } finally {
      setBusy(false);
    }
  }

  async function pickColor(id: string) {
    try {
      await api.setLoadout("color", id);
      await loadoutQ.refetch();
    } catch (e) {
      toast.error(apiErrorText(e, t`Could not set color`));
    }
  }

  return (
    <Card className="px-5 py-4.5 flex flex-col gap-3">
      <h2 className={H2}>
        <Trans>Appearance</Trans>
      </h2>

      <div className={cn(LABEL, "mt-1")}>
        <Trans>Display name</Trans>
      </div>
      <div className="flex gap-1.5 max-w-95">
        <input
          value={name}
          maxLength={32}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void saveName()}
          placeholder={t`Your name`}
          className="flex-1 min-w-0 bg-elev rounded-base px-3 py-1.5 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void saveName()}
          disabled={busy || !name.trim() || name.trim() === current}
        >
          <Trans context="save the display name typed beside this button">Save</Trans>
        </Button>
      </div>

      <div className={cn(LABEL, "mt-2")}>
        <Trans>Seat color</Trans>
      </div>
      {/* Eight a row on a phone, sixteen from `sm`: sixteen across a 320px card
          made every swatch 9px square. */}
      <div className="grid grid-cols-8 sm:grid-cols-[repeat(16,minmax(0,1fr))] gap-1.5 max-sm:gap-2">
        {colors.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={!c.available}
            onClick={() => void pickColor(c.id)}
            // A locked swatch says why: one reason is solved in the store, the
            // other by supporting. The colour's name comes from the catalog and
            // rides in as a named value.
            title={
              c.available
                ? c.name
                : c.price > 0
                  ? t`${c.name} (${formatNumber(c.price)} Pips in the store)`
                  : t`${c.name} (supporter color)`
            }
            data-swatch-edge={c.available ? swatchEdge(c.hex) : undefined}
            className={cn(
              "aspect-square w-full min-w-0 rounded-md",
              c.id === currentColor && SWATCH_PICKED,
              !c.available
                ? cn(SWATCH_LOCKED_WELL, "cursor-not-allowed")
                : "bg-(--swatch) hover:scale-110 transition-transform",
            )}
            style={{ "--swatch": c.hex } as CSSProperties}
          >
            {!c.available && (
              <span data-swatch-edge={swatchEdge(c.hex)} className={SWATCH_LOCKED_CHIP} />
            )}
          </button>
        ))}
      </div>
      <div className="text-[13px] text-muted">
        <Trans>
          Seeds your seat in new tables. You can still change it per game. More colors are in the{" "}
          <a href="/store" className="underline">
            store
          </a>
          .
        </Trans>
      </div>
    </Card>
  );
}

/** A section's heading inside a card. */
const H2 = "font-display text-[17px] font-semibold leading-snug";
const LABEL = "text-[12px] font-semibold text-muted";

export function Profile() {
  const { t } = useLingui();
  const { me, loading, refresh, refreshSupporter } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [syncing, setSyncing] = useState(false);

  // Manual "Sync roles": re-pull Discord roles without a re-login so a newly
  // granted role (e.g. staff via /setrole) takes effect. Status updates live
  // via the auth provider; this only reports success or rate limiting.
  const syncRoles = async () => {
    setSyncing(true);
    try {
      await refreshSupporter(true);
      toast.info(t`Discord roles synced.`);
    } catch (e) {
      toast.error(
        e instanceof ApiErr && e.status === 429
          ? t`Just synced. Try again in a moment.`
          : t`Couldn't sync roles. Try again shortly.`,
      );
    } finally {
      setSyncing(false);
    }
  };

  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const mergeToken = params.get("merge");
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [mergeMsg, setMergeMsg] = useState<string>(
    params.get("linked")
      ? t`Account linked.`
      : params.get("link") === "error"
        ? t`Linking failed. Please try again.`
        : "",
  );
  const [mergeBusy, setMergeBusy] = useState(false);

  useEffect(() => {
    if (!mergeToken) return;
    api
      .mergePreview(mergeToken)
      .then(setPreview)
      .catch(() => {
        setMergeMsg(t`This merge request is invalid or expired.`);
      });
    // `t` is omitted: it is only read on the failure path, and listing it would
    // re-run the merge preview on a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeToken]);

  function clearMergeParams() {
    const u = new URL(window.location.href);
    ["merge", "merged", "linked", "link"].forEach((k) => u.searchParams.delete(k));
    window.history.replaceState({}, "", u.pathname + u.search);
  }

  async function doMerge() {
    if (!mergeToken) return;
    setMergeBusy(true);
    try {
      await api.mergeConfirm(mergeToken);
      clearMergeParams();
      setPreview(null);
      setMergeMsg(t`Accounts merged.`);
      void refresh();
    } catch {
      setMergeMsg(t`Merge failed. Please try again.`);
    } finally {
      setMergeBusy(false);
    }
  }

  const { data: friendsData } = useQuery({
    queryKey: ["friends"],
    queryFn: api.friends,
    enabled: !!me && !me.guest,
  });
  const { data: loadoutData } = useQuery({
    queryKey: ["loadout"],
    queryFn: api.loadout,
    staleTime: 60_000,
  });

  if (loading) {
    return (
      <Screen>
        <SiteHeader active="profile" compact />
        <div
          role="status"
          aria-live="polite"
          /* Bare on the page ground, no card behind it: page ink, not card ink. */
          className="flex flex-col items-center gap-3 py-20 text-[14px] text-on-background-muted"
        >
          <Spinner size={26} />
          <Trans>Loading…</Trans>
        </div>
      </Screen>
    );
  }
  if (!me) {
    return (
      <Screen>
        <SiteHeader active="profile" compact />
        <div className="text-center py-20">
          <div className="font-display text-[20px] font-heavy mb-4">
            <Trans>Log in to see your profile</Trans>
          </div>
          <Button asChild tone="discord">
            <Link to="/login">
              <Trans>Log in</Trans>
            </Link>
          </Button>
        </div>
      </Screen>
    );
  }

  const stats = me.stats ?? [];
  const totalGames = stats.reduce((n, s) => n + s.games, 0);
  const totalWins = stats.reduce((n, s) => n + s.wins, 0);
  const winRate = totalGames ? Math.round((totalWins / totalGames) * 100) : 0;
  const friends = friendsData?.friends ?? [];
  const color = avatarColor(me.id);

  // The optional pieces of the merge paragraph below, resolved here so the
  // paragraph is one message. The provider slug is a wire value ("discord");
  // it is capitalised here because it lands mid-sentence.
  const victimProvider = preview ? preview.provider.replace(/^./, (c) => c.toUpperCase()) : "";
  const victimGames = preview
    ? t`${plural(preview.victim.games, { one: "# game", other: "# games" })}`
    : "";
  const victimAccount = preview?.victim.isSupporter ? t`${victimGames}, supporter` : victimGames;

  // Built inside the component so the labels follow a language change.
  const STAT_TILES = [
    {
      key: "games",
      n: formatNumber(totalGames),
      label: t({ message: "Games", context: "profile stat tile, games played" }),
    },
    {
      key: "wins",
      n: formatNumber(totalWins),
      label: t({ message: "Wins", context: "profile stat tile, games won" }),
    },
    {
      key: "winrate",
      n: `${winRate}%`,
      label: t({ message: "Win rate", context: "profile stat tile" }),
    },
    {
      key: "rulesets",
      n: formatNumber(stats.length),
      label: t({ message: "Rulesets", context: "profile stat tile, rulesets played" }),
    },
  ];

  return (
    <Screen relative>
      <SiteHeader active="profile" compact />

      <PageBody>
        <div className="grid grid-cols-[1fr_320px] gap-4 max-[1000px]:grid-cols-1 items-start">
          <div className="flex flex-col gap-4 min-w-0">
            {/* header */}
            <Card className="px-5 py-5 flex items-center gap-4 max-[480px]:flex-wrap">
              <Avatar
                color={color}
                src={me.avatar || undefined}
                name={me.name}
                size={72}
                ring={0}
              />
              <div className="flex-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* The page's one h1: the identity card is the page's
                      heading. */}
                  <h1 className="font-display text-[26px] font-heavy leading-tight tracking-[-0.01em] flex items-center gap-2">
                    <DecoratedName decoration={loadoutData?.loadout?.decoration}>
                      {me.name}
                    </DecoratedName>
                  </h1>
                  {!me.guest &&
                    (() => {
                      const top = highestRankedRating(stats);
                      return top ? (
                        <RatingBadge
                          elo={top.elo}
                          games={top.games}
                          provisional={top.provisional}
                          ruleset={top.ruleset}
                          size="lg"
                        />
                      ) : null;
                    })()}
                </div>
                <div className="text-[14px] text-muted mt-1">
                  {me.guest ? (
                    <Trans>Guest account, sign in with Discord to keep your rating</Trans>
                  ) : (
                    plural(totalGames, { one: "# game played", other: "# games played" })
                  )}
                </div>
              </div>
              {me.guest && (
                <Button asChild variant="secondary" size="sm">
                  <a href="/auth/discord">
                    <Trans>Link Discord</Trans>
                  </a>
                </Button>
              )}
            </Card>

            {/* stat tiles */}
            <div className="grid grid-cols-4 gap-3 max-[640px]:grid-cols-2">
              {STAT_TILES.map((s) => (
                // Counters, not pieces: flat print slabs.
                <Card key={s.key} data-pb-flat="" className="px-4 py-3.5 flex flex-col gap-1">
                  <div className="font-display text-[28px] font-heavy leading-none tabular-nums">
                    {s.n}
                  </div>
                  <div className={LABEL}>{s.label}</div>
                </Card>
              ))}
            </div>

            {/* by mode */}
            <Card className="px-5 py-4.5 flex flex-col gap-3">
              <h2 className={H2}>
                <Trans>By ruleset</Trans>
              </h2>
              {stats.length === 0 && (
                <div className="text-[14px] text-muted">
                  <Trans>No games played yet. Jump into a table!</Trans>
                </div>
              )}
              {stats.map((s) => (
                <Fragment key={s.ruleset}>
                  <div className="flex items-center gap-3 max-sm:flex-wrap max-sm:gap-y-2">
                    {/* Per-module chips (e.g. [ISLANDS][KNIGHTS]): compact and
                    single-line where a combined label would wrap. */}
                    <div className="w-32 max-sm:w-auto shrink-0 flex flex-wrap items-center gap-1">
                      {rulesetTags(s.ruleset).map((tag) => (
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
                    {/* `min-w-20`, not `w-20`: the rows still read as columns,
                      but a longer translation (`# partidas`) can widen the box
                      instead of overflowing it. */}
                    <div className="text-[13px] text-muted font-num tabular-nums min-w-20 shrink-0 whitespace-nowrap">
                      {plural(s.games, { one: "# game", other: "# games" })}
                    </div>
                    {/* Win-rate bar: fill = wins/games, labelled as an absolute
                    rate. */}
                    {(() => {
                      const pct = s.games ? Math.round((s.wins / s.games) * 100) : 0;
                      return (
                        <div className="flex-1 flex items-center gap-2 min-w-0 max-sm:order-last max-sm:basis-full">
                          <div className="flex-1 h-2 bg-elev2 rounded-full overflow-hidden">
                            <div
                              className="h-full w-(--bar) bg-(--swatch)"
                              style={
                                {
                                  "--bar": `${pct}%`,
                                  "--swatch": rulesetTags(s.ruleset)[0].bg,
                                } as CSSProperties
                              }
                            />
                          </div>
                          {/* A minimum width, not a fixed one: `{pct}% win` is
                            much longer in Spanish, and the bar (`flex-1 min-w-0`)
                            gives up the width instead, since a proportion reads
                            fine narrow. */}
                          <span className="text-[13px] font-medium font-num tabular-nums text-muted min-w-12 text-right shrink-0 whitespace-nowrap">
                            <Trans>{pct}% win</Trans>
                          </span>
                        </div>
                      );
                    })()}
                    {/* Rating only exists for ranked rulesets; other rows show
                    no ELO. */}
                    {isRanked(s.ruleset) && (
                      <RatingBadge elo={s.elo} games={s.games} provisional={s.provisional} />
                    )}
                  </div>
                  {/* The casual four-player record, under the career row. A
                    separate line because it is a different population (non-ranked
                    games seated exactly four), not a breakdown of the career row.
                    Hidden until there is one. */}
                  {(() => {
                    const games = s.casual_games ?? 0;
                    if (games === 0) return null;
                    // Named `pct` so lingui reuses the `{pct}% win` message from
                    // the career row.
                    const pct = Math.round(((s.casual_wins ?? 0) / games) * 100);
                    return (
                      <div className="flex items-center gap-3 pl-35 max-[640px]:pl-0 text-[12px] text-muted font-num tabular-nums">
                        <span className="whitespace-nowrap">
                          <Trans context="non-ranked games at a four-player table">
                            Casual (4 players)
                          </Trans>
                        </span>
                        <span className="whitespace-nowrap">
                          {/* `s.casual_games ?? 0`, not the `games` local: lingui
                            keys a plural's argument off the expression, and a
                            member expression collapses to `{0}`, reusing the
                            message above instead of minting a new msgid. */}
                          {plural(s.casual_games ?? 0, { one: "# game", other: "# games" })}
                        </span>
                        <span className="whitespace-nowrap">
                          <Trans>{pct}% win</Trans>
                        </span>
                      </div>
                    );
                  })()}
                </Fragment>
              ))}
            </Card>

            {/* match history */}
            <MatchHistory userId={me.id} />

            {/* Appearance: the free half of how you present yourself, kept with
              the account rather than in the store. The lobby's seat picker
              edits one game; this sets the default for new seats. */}
            {!me.guest && <Appearance name={me.name} onSaved={refresh} />}

            {/* connected accounts */}
            {me && !me.guest && (
              <Card className="px-5 py-4.5 flex flex-col gap-3">
                <h2 className={H2}>
                  <Trans>Connected accounts</Trans>
                </h2>
                {mergeMsg ? (
                  <div className="rounded-base bg-elev px-3 py-2 text-[13px] font-medium">
                    {mergeMsg}
                  </div>
                ) : null}
                {preview ? (
                  <div className="rounded-base bg-elev p-3.5 space-y-2">
                    <div className="text-[15px] font-semibold">
                      <Trans>Merge another account?</Trans>
                    </div>
                    {/* One message with named values, so translators can reorder
                        it; the supporter note is computed above. The account
                        name is optional, so there are two whole messages, with
                        and without it, rather than a value that is sometimes
                        empty. */}
                    <div className="text-[13px] text-muted leading-relaxed">
                      {preview.victim.name ? (
                        <Trans>
                          The {victimProvider} account "{preview.victim.name}" belongs to a
                          different Costanio account ({victimAccount}). Merging moves its games,
                          stats, items, and Pips into this account and{" "}
                          <span className="font-semibold text-foreground">permanently deletes</span>{" "}
                          the other account. This can't be undone.
                        </Trans>
                      ) : (
                        <Trans>
                          The {victimProvider} account belongs to a different Costanio account (
                          {victimAccount}). Merging moves its games, stats, items, and Pips into
                          this account and{" "}
                          <span className="font-semibold text-foreground">permanently deletes</span>{" "}
                          the other account. This can't be undone.
                        </Trans>
                      )}
                    </div>
                    {preview.blocked === "shared_game" ? (
                      <div className="space-y-2">
                        <div className="text-[13px] font-semibold text-foreground">
                          <Trans>
                            These accounts have played in the same game, so they can't be merged
                            automatically.
                          </Trans>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setPreview(null);
                              clearMergeParams();
                            }}
                          >
                            <Trans context="call off the account merge">Cancel</Trans>
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          tone="accent"
                          onClick={() => {
                            void doMerge();
                          }}
                          disabled={mergeBusy}
                        >
                          {mergeBusy ? <Trans>Merging…</Trans> : <Trans>Merge accounts</Trans>}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setPreview(null);
                            clearMergeParams();
                          }}
                        >
                          <Trans context="call off the account merge">Cancel</Trans>
                        </Button>
                      </div>
                    )}
                  </div>
                ) : null}
                {["discord", "google"].map((provider) => {
                  const linked = me.identities?.find((i) => i.provider === provider);
                  return (
                    <div
                      key={provider}
                      className={cn(
                        "flex items-center justify-between gap-3",
                        provider !== "discord" && "border-t border-line pt-3",
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {provider === "discord" ? (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-discord text-main-foreground">
                            <DiscordIcon className="h-4 w-4" />
                          </span>
                        ) : (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-google-surface ring-1 ring-inset ring-google-rim">
                            <GoogleIcon className="h-4 w-4" />
                          </span>
                        )}
                        <div className="text-[14px] font-semibold capitalize truncate">
                          {provider}
                          {linked?.name ? (
                            <span className="text-muted font-normal"> · {linked.name}</span>
                          ) : null}
                        </div>
                      </div>
                      {linked ? (
                        <div className="flex items-center gap-2 shrink-0">
                          {provider === "discord" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={syncing}
                              onClick={() => {
                                void syncRoles();
                              }}
                            >
                              {syncing ? <Trans>Syncing…</Trans> : <Trans>Sync roles</Trans>}
                            </Button>
                          ) : null}
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={(me.identities?.length ?? 0) <= 1}
                            onClick={() => {
                              void (async () => {
                                if (provider === "discord") {
                                  const ok = await confirm({
                                    title: t`Unlink Discord?`,
                                    body: t`Unlinking Discord forfeits your supporter perks.`,
                                    confirmText: t`Unlink`,
                                    tone: "danger",
                                  });
                                  if (!ok) return;
                                }
                                await api.unlinkProvider(provider);
                                await refresh();
                              })();
                            }}
                          >
                            <Trans context="disconnect this account from yours">Unlink</Trans>
                          </Button>
                        </div>
                      ) : (
                        <Button asChild variant="secondary" size="sm">
                          <a href={`/auth/${provider}/link`}>
                            <Trans context="connect this account to yours">Link</Trans>
                          </a>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </Card>
            )}
          </div>

          {/* friends */}
          <Card className="px-5 py-4.5 flex flex-col gap-2.5">
            <h2 className={H2}>
              <Trans>Friends</Trans>
            </h2>
            <div className="text-[13px] text-muted leading-relaxed">
              <Trans>
                Friends are pending access from Discord. This feature isn't available yet.
              </Trans>
            </div>
            {me.guest && (
              <div className="text-[13px] text-muted">
                <Trans>Sign in with Discord to see friends.</Trans>
              </div>
            )}
            {!me.guest && friends.length === 0 && (
              <div className="text-[13px] text-muted">
                <Trans>No Discord friends on costan.io yet. Invite by link.</Trans>
              </div>
            )}
            {friends.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2.5 py-2 px-0.5 border-b border-line last:border-0"
              >
                <Avatar
                  color={avatarColor(f.id)}
                  src={f.avatar || undefined}
                  name={f.name}
                  size={34}
                  ring={2}
                />
                <div className="flex-1">
                  <div className="text-[14px] font-semibold">{f.name}</div>
                  <div
                    className={cn(
                      "text-[12px] font-semibold",
                      f.game ? "text-blue" : f.online ? "text-green" : "text-muted2",
                    )}
                  >
                    {f.game ? (
                      <Trans context="a friend's presence">In game</Trans>
                    ) : f.online ? (
                      <Trans context="a friend's presence">Online</Trans>
                    ) : (
                      <Trans context="a friend's presence">Offline</Trans>
                    )}
                  </div>
                </div>
                {f.game ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/game" search={{ g: f.game }}>
                      <Trans context="spectate a friend's game">Watch</Trans>
                    </Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/play">
                      <Trans context="invite a friend to a table">Invite</Trans>
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          </Card>
        </div>
      </PageBody>
    </Screen>
  );
}
