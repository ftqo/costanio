/**
 * The language selector, as a control that stands in a row of other controls.
 *
 * A menu rather than a row of pills, so it takes one control's width in the
 * lobby and site headers whatever the number of languages.
 *
 * The trigger names the current language, which is what a visitor who cannot
 * read the UI scans for. Below 420px it shrinks to the short form (`EN`,
 * `日本語`); assistive tech still reads "Language" plus the full name.
 *
 * The draft-quality notice sits at the foot of the open menu, so it is visible
 * while a language is being chosen.
 */
import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { CaretDown, Check, Translate } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/LocaleProvider";
import { RELEASED_LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from "@/lib/i18n";
import { DISCORD_INVITE_URL } from "@/lib/links";
import { inActivityMode } from "@/lib/activity";
import { cn } from "@/lib/utils";

export function LanguagePicker({
  align = "end",
  className,
}: {
  /** Which edge of the trigger the panel hangs from. */
  align?: "start" | "end";
  className?: string;
}) {
  const { locale, setLocale } = useLocale();
  const { t } = useLingui();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Every released language, plus the current one, so a reviewer on an
  // unreleased draft (via ?lang=) can switch back. With one language the
  // control is not drawn.
  const options = React.useMemo(
    () => Array.from(new Set<Locale>([...RELEASED_LOCALES, locale])),
    [locale],
  );

  // Absolute positioning, as in ui/menu: fixed-position popovers double-apply
  // their rect math under the app's CSS `zoom`.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Opening moves focus onto the current language, so arrows work right away.
  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    (el ?? listRef.current?.querySelector("button"))?.focus();
  }, [open]);

  const close = React.useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const onListKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(listRef.current?.querySelectorAll("button") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      items[(next + items.length) % items.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  if (options.length < 2) return null;

  return (
    <div
      ref={rootRef}
      className={cn("relative shrink-0", className)}
      // Escape closes from anywhere inside, including the trigger. Tabbing out
      // of the panel closes it too.
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
        }
      }}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Translate weight="bold" size={15} />
        {/* The accessible name is "Language <the language's own name>". */}
        <span className="sr-only">
          <Trans>Language</Trans>
        </span>
        {/* Below 420px the full name goes `sr-only`, not `hidden`, so screen
            readers still get it. */}
        <span className="max-[420px]:sr-only">{LOCALE_LABELS[locale]}</span>
        <span className="hidden max-[420px]:inline" aria-hidden>
          {LOCALE_SHORT_LABELS[locale]}
        </span>
        <CaretDown weight="bold" size={11} />
      </Button>

      {open && (
        <div
          className={cn(
            "absolute top-full mt-2 z-50 w-57.5 max-w-[calc(100vw-24px)] border border-rim bg-secondary-background rounded-card p-1.5 text-foreground shadow-hard-lg flex flex-col gap-1.5",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {/* The list scrolls on short screens; the notice stays put. */}
          <div
            ref={listRef}
            role="menu"
            aria-label={t`Language`}
            onKeyDown={onListKeyDown}
            className="flex flex-col gap-0.5 max-h-[min(50vh,320px)] overflow-y-auto"
          >
            {options.map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  // Each row is in the language it names, for screen readers
                  // and the per-script font stack.
                  lang={l}
                  onClick={() => {
                    void setLocale(l, { persist: true });
                    close();
                  }}
                  className={cn(
                    // The same rows as ui/menu: text until pointed at, then a well.
                    "flex items-center gap-2 px-2.5 py-1.5 text-[14px] rounded-lg text-left outline-none cursor-pointer transition-colors",
                    active ? "font-semibold" : "font-medium",
                    "hover:bg-elev focus-visible:bg-elev",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <Check
                    weight="bold"
                    size={14}
                    className={cn("shrink-0", active ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {LOCALE_LABELS[l]}
                </button>
              );
            })}
          </div>

          {/* Where to report a translation problem; links to the same Discord
              invite as the footer and /support. */}
          <p className="text-[11px] leading-snug text-muted font-medium border-t border-line px-2.5 pt-2 pb-1">
            {/* Plain text inside the Discord Activity, like UnlockRoute's
                /support button (see components/StoreShelves): a
                `target="_blank"` from the sandboxed iframe either does nothing
                or pulls the player out of the call. */}
            {inActivityMode() ? (
              <span className="font-bold">
                <Trans>Report a translation problem on Discord</Trans>
              </span>
            ) : (
              <a
                href={DISCORD_INVITE_URL}
                target="_blank"
                rel="noreferrer"
                className="font-bold underline hover:text-foreground"
              >
                <Trans>Report a translation problem on Discord</Trans>
              </a>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
