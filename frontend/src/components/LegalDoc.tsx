import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { formatDate } from "@/lib/intl";

/* ------------------------------------------------------------------ *
 * Shared layout + prose primitives for the Terms and Privacy pages.
 * A sticky table of contents on the left, the document on the right.
 * Everything routes through theme tokens (no hardcoded colors).
 *
 * The documents stay in English, since an unreviewed translation would be a
 * second, unvetted version of the terms. The page chrome is translated, and
 * other-language readers are told the text is in English.
 * ------------------------------------------------------------------ */

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-[14px] text-muted leading-[1.65] max-w-[72ch]">{children}</p>;
}

export function B({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-foreground">{children}</span>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:|^mailto:/.test(href);
  return (
    <a
      href={href}
      {...(external && !href.startsWith("mailto:") ? { target: "_blank", rel: "noreferrer" } : {})}
      className="font-medium text-main-ink underline decoration-1 underline-offset-2 hover:text-foreground"
    >
      {children}
    </a>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <li key={i} className="text-[14px] text-muted leading-[1.6] pl-4 relative max-w-[72ch]">
          <span
            aria-hidden
            className="absolute left-0 top-[0.7em] size-1.5 rounded-full bg-line-strong"
          />
          {it}
        </li>
      ))}
    </ul>
  );
}

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    if (!ids.length) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const scroller = document.scrollingElement ?? document.documentElement;
      const line = Math.max(120, window.innerHeight * 0.25);
      if (window.innerHeight + window.scrollY >= scroller.scrollHeight - 2) {
        setActive(ids[ids.length - 1]);
        return;
      }
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

export function LegalDoc({
  title,
  updated,
  intro,
  sections,
}: {
  title: ReactNode;
  /** An ISO date (`2026-06-23`), formatted in the reader's language. */
  updated: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  const { i18n } = useLingui();
  // Noon UTC, so no timezone west or east of Greenwich moves it a day.
  const date = formatDate(`${updated}T12:00:00Z`, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const ids = useMemo(() => sections.map((s) => s.id), [sections]);
  const active = useScrollSpy(ids);

  function go(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <Screen>
      <SiteHeader compact />

      <PageBody>
        <PageTitle
          title={title}
          subtitle={
            <>
              <Trans>Last updated: {date}</Trans>
              {i18n.locale !== "en" && (
                <>
                  {" · "}
                  <Trans>This document is in English, the version that applies.</Trans>
                </>
              )}
            </>
          }
        />

        <div className="grid grid-cols-[230px_1fr] gap-4 max-[900px]:grid-cols-1">
          {/* table of contents */}
          <div className="self-start sticky top-4 max-[900px]:static max-[900px]:order-2">
            <Card className="p-3 flex flex-col gap-0.5">
              <div className="text-[12px] font-semibold text-muted px-2.5 pt-1 mb-1.5">
                <Trans context="table of contents heading">Contents</Trans>
              </div>
              {sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(s.id)}
                  className={
                    s.id === active
                      ? "text-left bg-selected text-selected-ink rounded-base px-2.5 py-1.5 text-[13px] font-semibold cursor-pointer"
                      : "text-left rounded-base px-2.5 py-1.5 text-[13px] text-muted hover:bg-elev hover:text-foreground cursor-pointer"
                  }
                >
                  {s.title}
                </button>
              ))}
            </Card>
          </div>

          {/* document body: one piece for the whole document; its intro and
              sections are print inside it (pb-site.css, `data-pb-region`). */}
          <div data-pb-region="" className="flex flex-col gap-3.5 min-w-0 max-[900px]:order-1">
            <Card className="px-6 py-5 flex flex-col gap-2 max-[520px]:px-4">{intro}</Card>
            {sections.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className={cn(
                  cardVariants(),
                  "scroll-mt-4 px-6 py-5 flex flex-col gap-3 max-[520px]:px-4",
                )}
              >
                <h2 className="font-display text-[17px] font-semibold flex items-baseline gap-2">
                  <span className="font-num text-[12px] font-medium text-muted tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </PageBody>
    </Screen>
  );
}
