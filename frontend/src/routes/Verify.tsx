import * as React from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trans, useLingui } from "@lingui/react/macro";
import { SiteHeader } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { ShieldCheck, ShieldWarning, Certificate } from "@/lib/icons";
import { verify, type VerifyResult, type Check, type Roll } from "@verify/verify.mjs";

/**
 * The fairness audit page.
 *
 * `/verify?g=<id>` fetches a finished game's replay and re-derives from the
 * released seed everything that seed decided: the board, the seating, every
 * roll, then says whether the log agrees.
 *
 * The check runs in the reader's browser on code they can read, so this page
 * stays thin: fetch, call `verify()`, render. Anything that interprets a
 * result belongs in verify/, where the tests and auditors can see it. Since we
 * serve this page, the download at the bottom (run it yourself) is the
 * stronger check, and the copy says so.
 */
export function Verify() {
  const { t } = useLingui();
  // `inv` rides alongside `g` as on /game and /replay: a spectator reached a
  // private table by link, and the replay endpoint takes the same code.
  const { g: gameId, inv: invite } = useSearch({ from: "/verify" });

  const replay = useQuery({
    // The invite is part of the key, as on /replay: the same game id with and
    // without a code are different answers (one a 403).
    queryKey: ["replay-text", gameId, invite ?? ""],
    queryFn: () => api.replayText(gameId!, invite),
    enabled: !!gameId,
    retry: false,
  });

  // Re-deriving a long game is real work, so it is memoized on the text.
  //
  // A throw is kept and shown rather than swallowed: otherwise every branch
  // below (guarded on `result`) renders nothing, and a malformed log or a
  // verifier bug would leave the page silent.
  const audit: { result: VerifyResult | null; error: string | null } = React.useMemo(() => {
    if (!replay.data) return { result: null, error: null };
    try {
      return { result: verify(replay.data), error: null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [replay.data]);
  const result = audit.result;

  return (
    <Screen>
      <SiteHeader compact />
      <PageBody>
        <PageTitle
          icon={<ShieldCheck size={26} weight="fill" />}
          title={<Trans>Verify a game</Trans>}
          subtitle={<Trans>Re-derive a finished game from the seed we committed to.</Trans>}
        />

        {!gameId && <PickAGame />}

        {gameId && replay.isPending && (
          <Card>
            <div className="flex items-center justify-center gap-2.5 py-10 text-[14px] text-muted">
              <Spinner />
              <Trans>Fetching the game log</Trans>
            </div>
          </Card>
        )}

        {gameId && replay.isError && (
          <Card>
            <div className="flex flex-col items-center gap-3 py-10">
              <ShieldWarning size={28} weight="fill" className="text-red-ink" />
              <div className="text-[14px] font-semibold">
                {apiErrorText(replay.error, t`That game could not be loaded.`)}
              </div>
              {/* Only when there is no invite: a reader who followed a link to a
                  table they did not sit at has no games of their own to list. */}
              {!invite && (
                <Button asChild variant="secondary" size="sm">
                  <Link to="/replay">
                    <Trans>Back to your games</Trans>
                  </Link>
                </Button>
              )}
            </div>
          </Card>
        )}

        {audit.error && (
          <Card>
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <ShieldWarning size={28} weight="fill" className="text-red-ink" />
              <div className="text-[15px] font-semibold">
                <Trans>The check could not be run on this log.</Trans>
              </div>
              <p className="text-[14px] text-muted leading-relaxed max-w-[52ch]">
                <Trans>
                  That is a fault in this checker, not a finding about the game: nothing here has
                  been checked either way. Please send us the game.
                </Trans>
              </p>
              <code className="bg-elev rounded-base px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5] break-all">
                {audit.error}
              </code>
            </div>
          </Card>
        )}

        {result && (
          <>
            <Verdict result={result} />
            <HowItWorks />
            <Checks checks={result.checks} />
            {result.rolls.length > 0 && <Rolls rolls={result.rolls} />}
            <RunItYourself gameId={gameId} invite={invite} />
          </>
        )}
      </PageBody>
    </Screen>
  );
}

/* ---------------------------------------------------------------- surfaces */

/** A card with the house header strip: a mono label over a hairline. */
function Section({
  label,
  aside,
  children,
}: {
  label: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-line">
        <span className="min-w-0 text-[11px] font-semibold text-muted">{label}</span>
        {aside && <span className="shrink-0">{aside}</span>}
      </div>
      {children}
    </Card>
  );
}

/* ----------------------------------------------------------------- verdict */

/**
 * The answer, before any of the working: a panel with the state carried by
 * the seal beside the word (green, red or neutral). It is the first and
 * largest thing on the page.
 */
function Verdict({ result }: { result: VerifyResult }) {
  const verified = result.verdict === "verified";
  const failed = result.verdict === "failed";
  const seal = verified
    ? "bg-green-tint text-green-ink"
    : failed
      ? "bg-red-tint text-red-ink"
      : "bg-elev text-muted";
  const word = verified ? "text-green-ink" : failed ? "text-red-ink" : "text-foreground";

  return (
    <Card>
      <div className="flex items-center gap-4 px-5 py-5 max-sm:items-start">
        <div className={`shrink-0 grid place-items-center h-16 w-16 rounded-card ${seal}`}>
          {failed ? (
            <ShieldWarning size={32} weight="fill" />
          ) : verified ? (
            <ShieldCheck size={32} weight="fill" />
          ) : (
            <Certificate size={32} weight="fill" />
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-1">
          <div
            className={`font-display text-[26px] leading-tight font-heavy tracking-[-0.01em] ${word}`}
          >
            {verified && <Trans>Verified</Trans>}
            {failed && <Trans>Does not check out</Trans>}
            {result.verdict === "unauditable" && <Trans>Not checked</Trans>}
          </div>
          <div className="text-[14px] leading-relaxed text-muted max-w-[62ch]">
            {verified && (
              <Trans>
                Everything below was worked out from the released seed, and every one of them
                matches what the log says happened.
              </Trans>
            )}
            {failed && (
              <Trans>
                At least one outcome is not what this seed produces. That should not be possible.
                Please send this game to us.
              </Trans>
            )}
            {result.verdict === "unauditable" && (
              <Trans>
                Something this seed decided could not be worked out here, so this page will not call
                the game verified. The list below says exactly what ran and what did not.
              </Trans>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/**
 * Why the verdict means anything: three steps in time, numbered because the
 * order is the argument (a fingerprint published after the board was dealt
 * would prove nothing).
 *
 * Step 2 is a claim about the engine. "Hidden things run on a second,
 * separate seed" holds only while every visible outcome runs on the public
 * one. (The Fishermen old boot once broke it; it now draws from a reserved
 * public slot, engine.FishBootSeq, and the audit re-derives it.) Before adding
 * a rule whose result the table can see, check which seed decides it.
 */
const STEPS = [
  {
    n: 1,
    when: <Trans>Before anyone joins</Trans>,
    what: (
      <Trans>
        The server publishes a fingerprint of the seed. Not the seed. It cannot try seeds until it
        likes the board, because the fingerprint is already public.
      </Trans>
    ),
  },
  {
    n: 2,
    when: <Trans>All game</Trans>,
    what: (
      <Trans>
        The board, the seating and every roll follow from that seed by a fixed rule, so nobody
        chooses them. Hidden things run on a second, separate seed.
      </Trans>
    ),
  },
  {
    n: 3,
    when: <Trans>When it ends</Trans>,
    what: (
      <Trans>
        Both seeds are released. This page works the outcomes out again from the first one and
        compares them to the log, in your browser.
      </Trans>
    ),
  },
];

function HowItWorks() {
  return (
    <Section label={<Trans>How this works</Trans>}>
      <ol className="grid gap-px bg-line sm:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="bg-secondary-background flex flex-col gap-2 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="bg-elev2 text-foreground inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-num text-[10.5px] font-medium tabular-nums">
                {s.n}
              </span>
              <span className="text-[11px] font-semibold">{s.when}</span>
            </div>
            <p className="text-[13px] text-muted leading-relaxed">{s.what}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------ checks */

const STATUS_PILL = {
  ok: "bg-green-tint text-green-ink",
  FAILED: "bg-red-tint text-red-ink",
  skipped: "bg-elev text-muted",
} as const;

function Checks({ checks }: { checks: Check[] }) {
  return (
    <Section label={<Trans>What was checked</Trans>}>
      <ul className="flex flex-col">
        {checks.map((c, i) => (
          <li
            key={c.name}
            className={`flex items-start gap-3 px-5 py-3 ${i > 0 ? "border-t border-line" : ""}`}
          >
            <span
              className={`shrink-0 mt-px inline-flex items-center justify-center min-w-13 rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${STATUS_PILL[c.status]}`}
            >
              {c.status === "ok" && <Trans>Pass</Trans>}
              {c.status === "FAILED" && <Trans>Fail</Trans>}
              {c.status === "skipped" && <Trans context="not applicable">N/A</Trans>}
            </span>
            <div className="min-w-0 flex flex-col gap-1">
              <div className="text-[14px] font-semibold leading-tight">{c.name}</div>
              {c.detail && <Detail text={c.detail} />}
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * A check's supporting line. A bare hash is data, not prose, so it is set in
 * the mono face on an inset the way the rest of the app sets a readout; a
 * sentence stays a sentence.
 */
function Detail({ text }: { text: string }) {
  const hash = /\b[0-9a-f]{64}\b/.exec(text);
  if (!hash) {
    return <div className="text-[13px] text-muted leading-relaxed">{text}</div>;
  }
  const before = text
    .slice(0, hash.index)
    .replace(/[=:]\s*$/, "")
    .trim();
  return (
    <div className="flex flex-col gap-1.5">
      {before && <div className="text-[13px] text-muted leading-relaxed">{before}</div>}
      <code className="bg-elev rounded-base px-2.5 py-1.5 font-mono text-[11.5px] leading-[1.5] break-all">
        {hash[0]}
      </code>
    </div>
  );
}

/* ------------------------------------------------------------------- rolls */

const PREVIEW = 12;

function Rolls({ rolls }: { rolls: Roll[] }) {
  const [open, setOpen] = React.useState(false);
  const mismatches = rolls.filter((r) => r.status === "MISMATCH").length;
  // A mismatch is never hidden behind "show all": surfacing it is the page's
  // job, and it can sit at roll 300 of 400.
  const shown = open || mismatches > 0 ? rolls : rolls.slice(0, PREVIEW);

  return (
    <Section
      label={<Trans>Every roll</Trans>}
      aside={
        <span className="font-num text-[11px] tabular-nums text-muted">
          {mismatches > 0 ? (
            <Trans>
              {mismatches} of {rolls.length} do not match
            </Trans>
          ) : (
            <Trans>{rolls.length} rolls, all matching</Trans>
          )}
        </span>
      }
    >
      {/* Its own scroller, so a narrow screen never scrolls the page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] font-num tabular-nums border-collapse">
          <thead>
            <tr className="text-left text-[10.5px] text-muted font-semibold">
              <th className="px-5 max-sm:px-3 py-2 font-medium w-16">#</th>
              <th className="px-5 max-sm:px-3 py-2 font-medium">
                <Trans context="the dice the game dealt">Rolled</Trans>
              </th>
              <th className="px-5 max-sm:px-3 py-2 font-medium">
                <Trans>From the seed</Trans>
              </th>
              <th className="px-5 max-sm:px-3 py-2 font-medium text-right">
                <Trans>Result</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const bad = r.status === "MISMATCH";
              return (
                <tr key={r.seq} className={`border-t border-line ${bad ? "bg-red-tint" : ""}`}>
                  <td className="px-5 max-sm:px-3 py-1.5 text-muted">{r.n}</td>
                  <td className="px-5 max-sm:px-3 py-1.5 font-semibold whitespace-nowrap">
                    {r.logged[0]} + {r.logged[1]}
                    <span className="text-muted font-normal"> = {r.logged[0] + r.logged[1]}</span>
                  </td>
                  <td className="px-5 max-sm:px-3 py-1.5 font-semibold whitespace-nowrap">
                    {r.expected ? (
                      `${r.expected[0]} + ${r.expected[1]}`
                    ) : (
                      <span className="text-muted font-normal">–</span>
                    )}
                  </td>
                  <td className="px-5 max-sm:px-3 py-1.5 text-right">
                    {bad ? (
                      <span className="inline-flex rounded-md bg-red-tint px-2 py-0.5 text-[10.5px] font-semibold text-red-ink">
                        <Trans>Mismatch</Trans>
                      </span>
                    ) : r.expected ? (
                      <span className="text-[12.5px] text-muted">
                        <Trans>matches</Trans>
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-muted">
                        <Trans context="a roll the Alchemist named, which no seed decided">
                          declared
                        </Trans>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length < rolls.length && (
        <div className="border-t border-line px-5 py-3">
          <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
            <Trans>Show all {rolls.length} rolls</Trans>
          </Button>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------ do it yourself */

function RunItYourself({ gameId, invite }: { gameId?: string; invite?: string }) {
  // The invite goes into the command as into the fetch above; without it a
  // spectator's copy of the command would get a 403.
  const query = invite ? `?inv=${encodeURIComponent(invite)}` : "";
  const commands =
    `curl -L -o verify.js https://costan.io/verify.js\n\n` +
    `curl -b "$COOKIE" -o replay.json \\\n` +
    `  https://costan.io/api/games/${gameId ?? "GAME_ID"}/replay${query}\n\n` +
    `node -e 'const v = require("./verify.js"), fs = require("fs");\n` +
    `  console.log(v.format(v.verify(fs.readFileSync("replay.json", "utf8"))))'`;

  return (
    <Section label={<Trans>Do not take our word for it</Trans>}>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-[14px] text-muted leading-relaxed max-w-[68ch]">
          <Trans>
            We serve this page, so it proves less than it looks like it does. The same check is one
            file with no dependencies and no install step. Save it, save your game log, and run it
            yourself.
          </Trans>
        </p>
        {/* Wrapped, not scrolled, so the whole command is visible to copy. */}
        <pre className="bg-elev text-foreground rounded-base px-4 py-3.5 font-mono text-[12px] leading-[1.7] whitespace-pre-wrap break-words">
          <code>{commands}</code>
        </pre>
        <p className="text-[12.5px] text-muted leading-relaxed max-w-[68ch]">
          <Trans>
            Hand it the raw text of the log, not a parsed object: a seed is a 64-bit number and
            JSON.parse rounds it off.
          </Trans>
        </p>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------- empty state */

function PickAGame() {
  return (
    <Card>
      <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
        <Certificate size={34} weight="fill" className="text-muted" />
        <div className="text-[17px] font-semibold">
          <Trans>Pick one of your finished games</Trans>
        </div>
        <p className="text-[14px] text-muted leading-relaxed max-w-[52ch]">
          <Trans>
            Only someone who sat at a table can release its seed, so the check runs on games you
            played in.
          </Trans>
        </p>
        <Button asChild className="mt-1">
          <Link to="/replay">
            <Trans>Your games</Trans>
          </Link>
        </Button>
      </div>
    </Card>
  );
}
