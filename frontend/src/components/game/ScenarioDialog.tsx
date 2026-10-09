import type { ComponentProps } from "react";
import { useLingui } from "@lingui/react/macro";
import { Overlay } from "./Overlay";

/** Shared reading width and reachable dismissal for scenario decisions. */
export function ScenarioDialog(props: ComponentProps<typeof Overlay>) {
  const { t } = useLingui();
  return (
    <Overlay
      {...props}
      dismissLabel={t`Close`}
      className="w-110 gap-4 [&_button]:min-h-10 [&_p]:leading-relaxed"
    />
  );
}
