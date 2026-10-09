import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, CaretDown, Sword, Funnel, UsersThree } from "@/lib/icons";
import { SiteHeader, avatarColor } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { Skeleton } from "@/components/ui/skeleton";
import { DecoratedName } from "@/components/DecoratedName";
import { Menu, MenuItem } from "@/components/ui/menu";
import { useRankedQueue } from "@/components/RankedQueueProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { currentLocale } from "@/lib/i18n";
import { useAbandonGuard } from "@/components/AbandonGuard";
import {
  rulesetTags,
  defaultConfig,
  moduleLabel,
  moduleColor,
  FILTER_MODULES,
  PLAYER_COUNTS,
} from "@/lib/format";
import type { Summary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";

export function Play() {
  const { me } = useAuth();
  const { t } = useLingui();
  const { joinRanked } = useRankedQueue();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const guard = useAbandonGuard();
  const { exp, players, open } = useSearch({ strict: false });
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // On phones the filter row is hidden behind a funnel toggle to keep the action
  // row tight; on sm+ the filters always show (the toggle button is hidden).
  const [showFilters, setShowFilters] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["games"],
    queryFn: api.browse,
    refetchInterval: 4000,
  });

  const selectedExp = exp ? exp.split(",").filter(Boolean) : [];
  const anyFilter = selectedExp.length > 0 || !!players || !!open;

  const games = (data?.games ?? [])
    .filter((s) => {
      const parts = new Set((s.game.ruleset || "base").split("+"));
      return selectedExp.every((m) => parts.has(m)); // table includes every chosen expansion
    })
    .filter((s) => (players ? s.game.config.players === players : true))
    .filter((s) => (open ? s.seats.length < s.game.config.players : true))
    // Folded in the active locale, not with locale-invariant `toLowerCase`:
    // Turkish folds `I` to `ı` and `İ` to `i`, so typing `ışıl` must match a
    // host named IŞIL. Both sides use the reader's fold via `currentLocale()`.
    .filter((s) => {
      if (!search) return true;
      const loc = currentLocale();
      return hostName(s).toLocaleLowerCase(loc).includes(search.toLocaleLowerCase(loc));
    });

  // Creating and joining public tables is for registered Discord accounts.
  // Guests and anonymous visitors may browse, but every action is gated (see
  // the nudge banner below).
  const registered = !!me && !me.guest;

  // Filters live in the URL so they're shareable and the landing-page mode
  // buttons can deep-link straight into a filtered view. Each setter merges a
  // patch and drops empty values to keep the URL clean.
  function setFilters(patch: { exp?: string; players?: number; open?: boolean }) {
    const next = { exp, players, open, ...patch };
    void navigate({
      to: "/play",
      search: {
        exp: next.exp || undefined,
        players: next.players || undefined,
        open: next.open || undefined,
      },
    });
  }

  function toggleExp(module: string) {
    const set = new Set(selectedExp);
    if (set.has(module)) set.delete(module);
    else set.add(module);
    setFilters({ exp: [...set].join(",") || undefined });
  }

  function clearFilters() {
    void navigate({ to: "/play", search: {} });
  }

  async function newTable() {
    if (!registered) return;
    if (!(await guard())) return;
    setBusy(true);
    try {
      const s = await api.createGame(defaultConfig(), true);
      void qc.invalidateQueries({ queryKey: ["games"] });
      void navigate({ to: "/lobby", search: { g: s.game.id } });
    } finally {
      setBusy(false);
    }
  }

  async function join(id: string) {
    if (!registered) return;
    if (!(await guard(id))) return;
    try {
      await api.join(id);
    } catch {
      /* already seated is fine */
    }
    void navigate({ to: "/lobby", search: { g: id } });
  }

  return (
    <Screen relative>
      <SiteHeader active="lobby" compact />

      <PageBody className="gap-2.5">
        <PageTitle
          icon={<UsersThree weight="bold" size={26} />}
          title={<Trans context="page title of the table browser">Play</Trans>}
          subtitle={<Trans>Join a table, or start your own.</Trans>}
        />
        {/* The controls get their own row rather than the title's `actions`
            slot, so the search field has room to grow. */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t`Search tables…`}
            // A minimum width, so the row wraps before the field shrinks to a
            // few letters (German button labels are long at 320px).
            // ui/input's field, drawn inline so the row keeps its flex sizing.
            className="flex-1 min-w-35 sm:min-w-45 h-9 bg-secondary-background border border-border rounded-control px-3.5 text-[14px] font-medium text-foreground placeholder:text-muted2 shadow-[inset_0_1px_2px_rgba(10,24,48,0.06)] focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          />
          {/* Filters toggle: phones only. The funnel tints when any filter is
              active so a collapsed row still signals it's filtered. */}
          <Button
            onClick={() => setShowFilters((v) => !v)}
            size="icon"
            variant="secondary"
            aria-label={t`Filters`}
            aria-expanded={showFilters}
            title={t`Filters`}
            pressed={anyFilter}
            className="sm:hidden h-9 w-9"
          >
            <Funnel weight="bold" />
          </Button>
          {/* New table: a full labelled button on desktop, a compact plus icon
              on phones. The Ranked dropdown sits beside it on every size. */}
          <Button
            onClick={() => {
              void newTable();
            }}
            // The page's one filled action (Button's default primary, amber).
            className="hidden sm:inline-flex h-9"
            size="sm"
            disabled={busy || !registered}
            title={!registered ? t`Log in to create a table` : undefined}
          >
            <Plus weight="bold" />
            <Trans>New table</Trans>
          </Button>
          <Button
            onClick={() => {
              void newTable();
            }}
            size="icon"
            disabled={busy || !registered}
            title={!registered ? t`Log in to create a table` : t`New table`}
            aria-label={t`New table`}
            className="sm:hidden h-9 w-9"
          >
            <Plus weight="bold" />
          </Button>
          {registered ? (
            <Menu
              align="end"
              contentClassName="min-w-45"
              // eslint-disable-next-line shadcn/require-static-classes -- the trigger is drawn as a secondary Button, by that primitive's own variant function.
              triggerClassName={cn(buttonVariants({ variant: "secondary", size: "sm" }), "h-9")}
              trigger={
                <>
                  <Sword weight="bold" />
                  <Trans>Ranked</Trans>
                </>
              }
            >
              <MenuItem
                onSelect={() => {
                  void joinRanked("base");
                }}
              >
                {/* "4p" is the seat count of the ranked queue, not prose. */}
                <Trans context="ranked queue, base ruleset, 4 players">Base (4p)</Trans>
              </MenuItem>
              <MenuItem
                onSelect={() => {
                  void joinRanked("cak");
                }}
              >
                <Trans context="ranked queue, Knights ruleset, 4 players">Knights (4p)</Trans>
              </MenuItem>
            </Menu>
          ) : (
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="h-9"
              title={t`Log in for ranked`}
            >
              <Link to="/login">
                <Sword weight="bold" />
                <Trans>Ranked</Trans>
              </Link>
            </Button>
          )}
        </div>
        <div
          className={cn("items-center gap-2 flex-wrap sm:flex", showFilters ? "flex" : "hidden")}
        >
          {FILTER_MODULES.map((m) => {
            const active = selectedExp.includes(m);
            return (
              <Pill
                key={m}
                interactive
                size="md"
                tone={active ? "active" : "neutral"}
                aria-pressed={active}
                onClick={() => toggleExp(m)}
              >
                {/* The module's own colour, as a dot: identity, not state. The
                    ink fill is what says "on". */}
                <span
                  aria-hidden
                  className="size-2 rounded-full shrink-0 bg-(--swatch)"
                  style={{ "--swatch": moduleColor(m) } as React.CSSProperties}
                />
                {moduleLabel(m)}
              </Pill>
            );
          })}

          <Pill
            interactive
            size="md"
            tone={open ? "active" : "neutral"}
            aria-pressed={!!open}
            onClick={() => setFilters({ open: open ? undefined : true })}
            caps={false}
          >
            <Trans context="filter: tables with a free seat">Open seats</Trans>
          </Pill>

          {/* Styled like its sibling chips (see Pill): a surface chip at rest,
              filled with ink when a count is picked. */}
          <div className="relative">
            <select
              value={players ?? ""}
              onChange={(e) =>
                setFilters({ players: e.target.value ? Number(e.target.value) : undefined })
              }
              className={cn(
                "appearance-none rounded-lg border pl-3 pr-8 py-1 text-[13px] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                players
                  ? "bg-selected text-selected-ink border-selected"
                  : "bg-secondary-background text-foreground border-border shadow-hard-sm hover:bg-elev",
              )}
            >
              {/* An <option> takes text, not elements, so these go through `t`. */}
              <option value="">{t({ message: "Players", context: "filter by seat count" })}</option>
              {PLAYER_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {t`${plural(n, { one: "# player", other: "# players" })}`}
                </option>
              ))}
            </select>
            <CaretDown
              weight="bold"
              className={cn(
                "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2",
                players ? "text-selected-ink" : "text-muted",
              )}
              size={13}
            />
          </div>

          {anyFilter && (
            <button
              onClick={clearFilters}
              /* On the page ground, not in a card: muted card ink is ~1.5:1 on
                 the ocean. Matches the "New tables start private" hint beside it. */
              className="flex items-center gap-1 rounded-md px-1 text-[13px] font-semibold text-on-background-muted hover:text-on-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X weight="bold" size={13} />
              <Trans context="clear the active table filters">Clear</Trans>
            </button>
          )}

          <div className="ml-auto text-[13px] text-on-background-muted text-right pr-1">
            <Trans>New tables start private. Pick mode, map &amp; rules in the room</Trans>
          </div>
        </div>

        {!registered && (
          <div className="bg-secondary-background border border-rim rounded-card shadow-hard px-4 py-3 flex items-center gap-3 flex-wrap text-[13px]">
            <span>
              <Trans>
                Public tables are Discord-only. Log in to create or join one. Got an invite link?
                You can join a private table without an account.
              </Trans>
            </span>
            <a href="/auth/discord" className="ml-auto">
              <Button size="sm" tone="discord">
                <Trans>Log in with Discord</Trans>
              </Button>
            </a>
          </div>
        )}

        {isLoading && (
          <>
            <span className="sr-only" role="status">
              <Trans>Loading tables…</Trans>
            </span>
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="bg-secondary-background border border-rim rounded-card shadow-hard px-4 py-3 flex items-center gap-3.5"
              >
                <Skeleton className="w-9.5 h-9.5 rounded-full shrink-0" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-8 w-16 rounded-control" />
              </div>
            ))}
          </>
        )}
        {!isLoading && games.length === 0 && (
          // Plain text on the ground: no slot, no see-through well. The space
          // it held is kept so the page does not jump when a table appears.
          <div className="text-center text-[15px] font-semibold text-on-background py-10 rounded-card border border-transparent">
            {anyFilter ? (
              <Trans>No tables match these filters. Start one!</Trans>
            ) : (
              <Trans>No public tables right now. Start one!</Trans>
            )}
          </div>
        )}

        {games.map((s) => (
          <TableRow
            key={s.game.id}
            s={s}
            disabled={!registered}
            onJoin={() => {
              void join(s.game.id);
            }}
          />
        ))}
      </PageBody>
    </Screen>
  );
}

function hostName(s: Summary): string {
  return s.host_name || "–";
}

function TableRow({ s, onJoin, disabled }: { s: Summary; onJoin: () => void; disabled?: boolean }) {
  const { t } = useLingui();
  const tags = rulesetTags(s.game.ruleset);
  const seated = s.seats.length;
  const max = s.game.config.players;
  const full = seated >= max;
  const host = hostName(s);
  // Named, so the message carries `{secs}` rather than a positional `{0}`.
  const secs = s.game.config.turn_timer_sec;
  return (
    <div
      className={cn(
        "bg-secondary-background border border-rim rounded-card shadow-hard px-4 py-3 flex items-center gap-3.5 flex-wrap",
        full && "opacity-55",
      )}
    >
      <Avatar
        color={avatarColor(s.seats[0]?.user_id ?? 0)}
        src={s.seats[0]?.avatar || undefined}
        name={s.seats[0]?.user_name}
        size={38}
      />
      <div className="flex-1">
        <div className="text-[15px] font-semibold">
          {/* The decorated name is inside the message, so each language places
              the possessive. */}
          <Trans>
            <DecoratedName decoration={s.host_decoration}>{host}</DecoratedName>'s table
          </Trans>
        </div>
        <div className="text-[13px] text-muted">
          <Trans>Host: {host}</Trans> · {secs ? t`${secs}s timer` : t`No timer`}
        </div>
      </div>
      {/* `uppercase` in CSS, not in the source text: kana have no upper case and
          index.css turns this off for CJK. */}
      <div className="flex gap-1">
        {tags.map((tag) => (
          <Badge
            key={tag.label}
            // One neutral print tag for every ruleset (no rainbow).
            tone="rating"
            type="label"
            size="xs"
          >
            {tag.label}
          </Badge>
        ))}
      </div>
      <div className="font-num text-[13px] text-muted tabular-nums">
        {seated} / {max}
      </div>
      {full ? (
        <div className="rounded-control bg-elev px-4 py-1.5 text-[13px] font-medium text-muted2">
          <Trans context="table has no free seats">Full</Trans>
        </div>
      ) : (
        <Button
          onClick={onJoin}
          size="sm"
          disabled={disabled}
          title={disabled ? t`Log in to join public tables` : undefined}
        >
          <Trans context="take a seat at a table">Join</Trans>
        </Button>
      )}
    </div>
  );
}
