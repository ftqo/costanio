import { cn } from "@/lib/utils";

/** The heading row of a normal page: optional icon, the page's name, an
 * optional one-line subtitle, and an optional cluster of actions on the right.
 *
 * One `<h1>` per page, one type scale, and the subtitle inline where there is
 * room and wrapped under the title where there is not.
 *
 * `actions` is for controls that belong to the page as a whole rather than to a
 * row inside it: How to play's tab strip, a filter, a primary button. They sit
 * right-aligned on the title's line and wrap below it on a narrow screen. */
export function PageTitle({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    // scroll-mt-4 so an in-page anchor does not tuck the title under the top edge.
    <div className={cn("scroll-mt-4 flex items-center gap-3.5 flex-wrap", className)}>
      {/* The icon is decorative and hidden from screen readers. */}
      {icon && (
        <span aria-hidden className="shrink-0 flex items-center text-on-background">
          {icon}
        </span>
      )}
      <h1 className="font-display text-[26px] font-heavy leading-tight tracking-[-0.01em] text-on-background">
        {title}
      </h1>
      {subtitle && (
        // on-background-muted: text-muted is nearly invisible on the ocean.
        <div className="text-[14px] text-on-background-muted">{subtitle}</div>
      )}
      {actions && <div className="ml-auto flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
