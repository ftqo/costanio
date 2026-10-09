import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, ApiErr } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAbandonGuard } from "@/components/AbandonGuard";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { supportsWebGL } from "@/lib/board3d/webgl";
import {
  HOME_COLUMNS_QUERY,
  HOME_SHORT_QUERY,
  homeChrome,
  homeTier,
  type HomeTier,
} from "@/components/home/layout";
import { offeredRulesetLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Trans, useLingui } from "@lingui/react/macro";

/**
 * The board behind the headline, fetched only where it is drawn. Lazy because
 * this route is in the initial module graph (see router.tsx); a static import
 * would put Board3D and three.js in front of every visitor. See HomeScene for
 * why the recording rides the same chunk.
 */
const HomeScene = React.lazy(() => import("@/components/home/HomeScene"));

/**
 * The ruleset the hero's recording was played under, so the warm-up fetches
 * only the files it draws. Hardcoded because reading it from the recording
 * would import `attract.ts` here, defeating the lazy boundary above. `base` is
 * what `cmd/costan-replay` was run with; see `lib/replay/attract.ts`.
 */
const HERO_RULESET = "base";

/**
 * Start fetching the board's models as soon as the page mounts.
 *
 * `Board3D` loads its .glb files one at a time, a serial chain of round trips.
 * `loadAsset` caches by filename, so warming the same cache here turns each of
 * those awaits into a hit and the fetches run in parallel, with the same
 * failure handling (`preloadBoardModels` swallows its errors).
 *
 * Dynamically imported: `loader.ts` pulls in three.js, which the `React.lazy`
 * above keeps off phones that never draw a board. The import lands in the
 * chunk `HomeScene` already fetches.
 *
 * It fetches the whole ruleset (about 370 KB more than the hero draws); the
 * extra files are needed as soon as the visitor presses Play, and parallel
 * fetching still beats the serial chain.
 */
function useBoardModelWarmup() {
  React.useEffect(() => {
    if (!supportsWebGL()) return;
    void import("@/lib/board3d/loader")
      .then((m) => m.preloadBoardModels(HERO_RULESET))
      .catch(() => {});
  }, []);
}

/**
 * The three layout arrangements and their queries live in
 * `components/home/layout.ts`; this file draws them. Branched in JS because
 * they are different trees (two fixed overlays, one scrolling page), and the
 * camera has to know which one it is framing for.
 */
interface HeroProps {
  tier: HomeTier;
  /** Measured by the page, so the board can be framed clear of what was drawn. */
  ref: React.Ref<HTMLElement>;
  registered: boolean;
  code: string;
  setCode: (v: string) => void;
  joining: boolean;
  onJoin: (e: React.FormEvent) => void;
}

/**
 * The headline, the live count, the two actions and the private-code box. One
 * tree for every arrangement; only position and headline size differ.
 */
function Hero({ tier, ref, registered, code, setCode, joining, onJoin }: HeroProps) {
  const { t } = useLingui();
  return (
    <section
      ref={ref}
      className={cn(
        // on-background, not a literal white: the copy sits on the ocean, and
        // the scrim behind it keeps it legible.
        "absolute flex flex-col text-on-background",
        // The column is capped at 440px and shrinks with the window below that,
        // so one arrangement covers laptops, tablets and phones on their side.
        tier === "wide" && "left-[max(52px,4vw)] w-[min(440px,38vw)]",
        // A sideways phone gets a wider column: the island there is limited by
        // height, so the width is free, and the status line stays at two lines.
        tier === "short" && "left-10 w-[min(440px,46vw)]",
        // A screen with little height (a phone held sideways) compresses the
        // column's spacing so the code box stays on screen.
        tier === "wide" && "top-[188px] gap-[18px]",
        // Not enough alone, so the sideways phone also takes a smaller
        // headline, status line and buttons (below), to fit between the header
        // (~50px) and a two-row footer (~77px).
        tier === "short" && "top-15 gap-2",
        // Portrait: the copy is a full-width band above the island, using the
        // page margin. The margin and the offset under the header scale with the
        // viewport rather than stepping at breakpoints.
        tier === "stacked" && "left-[5vw] right-[5vw] top-[max(76px,11vh)] gap-[18px]",
      )}
    >
      <h1
        className={cn(
          "font-display font-heavy text-balance",
          // Baloo 2 sets a little loose at 52px, so a hair under zero there;
          // zero at the phone sizes.
          tier === "wide" && "text-[52px] tracking-[-0.01em]",
          // Tied to height on a sideways phone, since height is what it lacks:
          // 30px at 390 tall, 27px at 360, 24px at 320.
          // eslint-disable-next-line shadcn/no-arbitrary-values -- a height-tied clamp has no token, like its two sibling tiers
          tier === "short" && "text-[clamp(24px,7.5vh,30px)] tracking-normal",
          tier === "stacked" && "text-[clamp(30px,7vw,48px)] tracking-normal",
          // Last: tailwind-merge treats a font-size class as overriding any
          // earlier line-height (`text-lg/7` sets both), so a `leading-*`
          // before the size would be dropped.
          "leading-[1.06]",
        )}
        // A soft shadow in the brand navy, so the headline keeps its edge over
        // a pale tile. In the style prop because the color-mix value does not
        // survive Tailwind's underscore escaping legibly.
        style={{
          textShadow:
            "0 1px 2px color-mix(in srgb, var(--color-ink) 35%, transparent), 0 6px 24px color-mix(in srgb, var(--color-ink) 30%, transparent)",
        }}
      >
        <Trans>Trade and settle the land of Costanio</Trans>
      </h1>

      {/* A static line: a live table count would make the front page wait on
          the server, and this page should render when the server is down. The
          count is on /play. */}
      <div
        className={cn(
          // Semibold: Nunito is light and round, and at 500 this line thinned
          // out over the moving water.
          "font-semibold text-on-background-muted text-pretty",
          tier === "short" ? "text-[13px]" : "text-[15px]",
          // Below about 380px of height the column does not fit between header
          // and footer with this line, and it is the one line that is not an
          // action (the table browser says the same).
          tier === "short" && "[@media(max-height:380px)]:hidden",
        )}
      >
        <Trans>2–10 players</Trans> · {offeredRulesetLabel()}
      </div>

      <div className="flex gap-3 mt-1">
        {/* The one filled action: Button's default primary is the amber. */}
        <Button asChild size={tier === "short" ? "md" : "lg"}>
          <Link to="/play">
            <Trans context="go to the table browser">Play</Trans>
          </Link>
        </Button>
        {registered ? (
          <Button asChild size={tier === "short" ? "md" : "lg"} variant="secondary">
            <Link to="/lobby">
              <Trans>New table</Trans>
            </Link>
          </Button>
        ) : (
          <Button
            size={tier === "short" ? "md" : "lg"}
            variant="secondary"
            disabled
            title={t`Log in to create a table`}
          >
            <Trans>New table</Trans>
          </Button>
        )}
      </div>

      {/* on-background tokens, like the status line: text-muted and blue-ink
          are for card surfaces and come out dark on dark here. Dropped on a
          sideways phone, which has no height for a sentence that repeats a
          button. */}
      {!registered && tier !== "short" && (
        <div className="text-[13px] font-medium text-on-background-muted">
          {/* One message, not a link glued to a clause, so the translator
              places the link. */}
          <Trans>
            <a
              href="/auth/discord"
              className="text-on-background font-semibold underline underline-offset-2"
            >
              Log in with Discord
            </a>{" "}
            to host a table, or join a private one by code below.
          </Trans>
        </div>
      )}

      {/* The private-code box stays open to everyone: guests join a friend by
          link without an account, which is how most people arrive. */}
      <form onSubmit={onJoin} className="flex items-center gap-2.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={t`Join a private table`}
          name="table-invite"
          type="text"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          className={cn(
            // ui/input's field: panel fill, 1px rim, the control radius.
            "bg-secondary-background border border-border rounded-control px-3.5 py-2.5 font-medium text-foreground placeholder:text-muted2 w-full shadow-[inset_0_1px_2px_rgba(10,24,48,0.06)] focus:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
            // 16px on the phone: iOS Safari zooms in on a focused input smaller
            // than that and does not zoom back out.
            tier === "wide" || tier === "short"
              ? "max-w-[210px] text-[14px]"
              : "max-w-[240px] text-[16px]",
          )}
        />
        <Button type="submit" variant="secondary" disabled={joining || !code.trim()}>
          {joining ? "…" : <Trans context="take a seat at a table">Join</Trans>}
        </Button>
      </form>
    </section>
  );
}

/**
 * Which band of the frame a measured box occupies, named for the inset it
 * feeds. A copy column on the left occupies the left band and is measured by
 * its right edge; the footer occupies the bottom band and is measured by its
 * top.
 */
type Band = "left" | "top" | "bottom";

/**
 * How much of the viewport a box covers, as a fraction, along one axis.
 *
 * Measured, not assumed: the copy (whose headline wraps differently per
 * language) and the site footer (one row on desktop, stacked on a phone,
 * absent in the Discord Activity) have no fixed size, and the camera must
 * frame the island clear of what was actually drawn.
 *
 * The element arrives as state rather than a ref, so a remount re-measures.
 */
function useBandFrac(el: HTMLElement | null, band: Band, seed: number): number {
  // Seeded with a tuned value so the first frame is close; the effect corrects
  // it before paint, and environments with no layout keep the seed.
  const [frac, setFrac] = React.useState(seed);
  React.useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // An unlaid-out element measures zero on every side; keep the seed until
      // there is a real box (jsdom never gets one). A box with width and no
      // height is measured: it is the footer wrapper in the Discord Activity,
      // where SiteFooter draws nothing and the board gets the whole frame.
      if (r.width === 0 && r.height === 0) return;
      const h = window.innerHeight;
      setFrac(
        band === "left"
          ? r.right / window.innerWidth
          : band === "top"
            ? r.bottom / h
            : (h - r.top) / h,
      );
    };
    measure();
    // These resize without the window: a longer headline wraps, and the
    // footer's links wrap with the language.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [el, band]);
  return frac;
}

export function Landing() {
  const { me, ensureSession } = useAuth();
  const navigate = useNavigate();
  const guard = useAbandonGuard();
  const toast = useToast();
  const { t } = useLingui();
  const [code, setCode] = React.useState("");
  const [joining, setJoining] = React.useState(false);

  useBoardModelWarmup();

  const tier = homeTier(useMediaQuery(HOME_COLUMNS_QUERY), useMediaQuery(HOME_SHORT_QUERY));
  const [heroEl, setHeroEl] = React.useState<HTMLElement | null>(null);
  const [footEl, setFootEl] = React.useState<HTMLElement | null>(null);
  const [headEl, setHeadEl] = React.useState<HTMLElement | null>(null);
  // In columns the copy holds the left band and the board is framed to its
  // right; in stacked it holds the top band and the board sits under it. The
  // footer holds the bottom band in both.
  const copyFrac = useBandFrac(
    heroEl,
    tier === "stacked" ? "top" : "left",
    tier === "stacked" ? 0.4 : 0.34,
  );
  const footFrac = useBandFrac(footEl, "bottom", 0.12);
  // The header's controls sit over the top right of the frame, which is where
  // the columns arrangement puts the island. See `homeChrome`.
  const headFrac = useBandFrac(headEl, "top", 0.06);

  // Creating and joining public tables is registered-Discord-only. The private
  // code box stays open to everyone (guests join friends via a link).
  const registered = !!me && !me.guest;

  async function joinByCode(e: React.FormEvent) {
    e.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    await ensureSession();
    setJoining(true);
    try {
      // Accept either a bare code or a pasted invite link (…/g/<code>).
      const c = raw.split("/").pop()!.trim();
      const sum = await api.invite(c);
      if (!(await guard(sum.game.id))) {
        setJoining(false);
        return;
      }
      try {
        await api.join(sum.game.id, c);
      } catch {
        /* already seated is fine */
      }
      void navigate({ to: "/lobby", search: { g: sum.game.id } });
    } catch (err) {
      toast.error(
        err instanceof ApiErr && err.status === 404
          ? t`No table with that code.`
          : t`Could not join that table.`,
      );
      setJoining(false);
    }
  }

  const hero = (
    <Hero
      tier={tier}
      ref={setHeroEl}
      registered={registered}
      code={code}
      setCode={setCode}
      joining={joining}
      onJoin={(e) => {
        void joinByCode(e);
      }}
    />
  );

  const stacked = tier === "stacked";
  return (
    <div className="fixed inset-0 overflow-hidden bg-background">
      {/* No fallback: the page ground is already the ocean, so an unloaded
            scene is open water. */}
      <React.Suspense fallback={null}>
        <HomeScene chrome={homeChrome(tier, copyFrac, footFrac, headFrac)} />
      </React.Suspense>
      {/* A scrim so the headline is legible over whatever the replay shows. The
            gradient runs along the axis the copy is on, the axis the island was
            framed off. */}
      <div
        className={cn(
          "absolute pointer-events-none",
          stacked ? "inset-x-0 top-0" : "inset-y-0 left-0 w-[46%]",
        )}
        style={{
          // In stacked the scrim is sized to the copy, whose height depends on
          // language and width, with a short tail past it so it does not dim
          // the island (framed below the copy; see `homeChrome`).
          height: stacked ? `${Math.min(0.92, copyFrac + 0.06) * 100}%` : undefined,
          background: `linear-gradient(${stacked ? "to bottom" : "to right"},
              color-mix(in srgb, var(--color-ink) 86%, transparent) 0%,
              color-mix(in srgb, var(--color-ink) ${stacked ? 80 : 62}%, transparent) ${stacked ? 74 : 46}%,
              transparent 100%)`,
        }}
      />
      <div ref={setHeadEl} className="absolute top-0 left-0 right-0">
        <SiteHeader compact />
      </div>
      {hero}
      {/* The site's own footer, pinned because this page is a fixed overlay.
          No hairline: across the moving water it read as a stray bar, so a
          soft fade grounds the links instead. */}
      <div
        ref={setFootEl}
        className="absolute inset-x-0 bottom-0 bg-linear-to-b from-transparent to-ink/55"
      >
        <SiteFooter rule={false} />
      </div>
    </div>
  );
}
