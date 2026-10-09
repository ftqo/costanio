import { cn } from "@/lib/utils";
import { SiteFooter } from "@/components/SiteFooter";

/** Full-height sky page background that hosts a screen's content, with a
 * site-wide footer pinned to the bottom (content grows to fill, so the footer
 * sits at the bottom on short pages and after the content on tall ones).
 *
 * - `center` centers the content both axes (for loading / empty / auth states).
 * - `noFooter` drops the footer (the live game and self-contained auth screens). */
export function Screen({
  children,
  className,
  relative = false,
  center = false,
  noFooter = false,
}: {
  children: React.ReactNode;
  className?: string;
  relative?: boolean;
  center?: boolean;
  noFooter?: boolean;
}) {
  return (
    <div
      className={cn(
        // overflow-x-clip, not -hidden: -hidden makes this a scroll container
        // and breaks `position: sticky` in descendants (e.g. the How-to-play
        // sidebar).
        // on-background, not foreground: the page ground is the ocean. Cards
        // set their own colour.
        "min-h-full w-full bg-background text-on-background overflow-x-clip flex flex-col",
        relative && "relative",
        className,
      )}
    >
      <div
        className={cn(
          "flex-1 w-full",
          center ? "flex items-center justify-center" : "max-w-310 mx-auto",
        )}
      >
        {children}
      </div>
      {!noFooter && <SiteFooter />}
    </div>
  );
}
