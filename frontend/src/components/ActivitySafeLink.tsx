import type { ReactElement, ReactNode } from "react";
import { useLingui } from "@lingui/react/macro";
import { inActivityMode } from "@/lib/activity";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/game/Tip";

/** Keep website actions discoverable without mounting a navigable link in Discord. */
export function ActivitySafeLink({
  children,
}: {
  children: ReactElement<{
    children?: ReactNode;
    className?: string;
    "data-ui-button"?: string;
    "data-variant"?: string;
  }>;
}) {
  const { t } = useLingui();
  if (!inActivityMode()) return children;
  return (
    <Tip title={t`This functionality is available on the website`} tapToOpen>
      <span
        role="link"
        aria-disabled="true"
        tabIndex={0}
        // The button's look also reads these attributes (see `buttonLook`).
        data-ui-button={children.props["data-ui-button"]}
        data-variant={children.props["data-variant"]}
        className={cn(children.props.className, "cursor-not-allowed opacity-50")}
      >
        {children.props.children}
      </span>
    </Tip>
  );
}
