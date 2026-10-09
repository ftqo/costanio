import { cn } from "@/lib/utils";

/** The content column of a normal page, directly under `<SiteHeader compact />`.
 *
 * `Screen` owns the page ground, the 1240px cap and the footer; this owns the
 * gutters and the spacing between rows. Rows are a flex column with `gap-4`,
 * so a page writes them as plain siblings:
 *
 *     <PageBody>
 *       <PageTitle …/>
 *       <div>…content…</div>
 *     </PageBody>
 *
 * One width for every page, so the frame does not shift between routes. Prose
 * that wants a reading measure uses `max-w-prose` itself.
 *
 * Empty, loading and auth states centre themselves on the bare page ground and
 * do not use this. */
export function PageBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full flex flex-col gap-4 px-6 pt-1.5 pb-8", className)}>{children}</div>
  );
}
