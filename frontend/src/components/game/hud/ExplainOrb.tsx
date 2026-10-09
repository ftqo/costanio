import * as React from "react";
import { useLingui } from "@lingui/react/macro";
import { Question } from "@/lib/icons";
import { HudOrb } from "./HudLayer";
import { useExplaining, toggleExplaining, setExplaining } from "@/lib/explainMode";
import { useNoHover } from "@/lib/touch";

/**
 * The "what is that?" toggle: the discoverable way to ask on a screen with no
 * hover.
 *
 * Coarse pointers only: a mouse can just point, and the orb row is full. It is
 * bound to the input, not the viewport, so a touchscreen laptop gets it and a
 * small mouse-driven window doesn't (see `useNoHover`).
 *
 * A toggle rather than a picker button: the player doesn't know what to ask
 * about until they look, nor its name. Arm, then point.
 *
 * The mode stands down after one answer (lib/explainMode `answerGiven`) and on
 * Escape. It doesn't advertise itself; a `?` in a row of orbs is
 * self-describing.
 */
export function ExplainOrb() {
  const { t } = useLingui();
  const explaining = useExplaining();
  const noHover = useNoHover();

  // Escape disarms. Bound only while armed, and it can't compete with a
  // dialog's Escape: the mode can't be armed while one is open (the dialog
  // covers the orb).
  React.useEffect(() => {
    if (!explaining) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExplaining(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [explaining]);

  if (!noHover) return null;

  const label = explaining
    ? t({ message: "Tap anything to learn what it does", context: "explain mode is armed" })
    : t({ message: "What does this do?", context: "arm explain mode" });

  return (
    <HudOrb
      title={label}
      aria-label={label}
      aria-pressed={explaining}
      active={explaining}
      onClick={toggleExplaining}
    >
      <Question weight="bold" size={16} />
    </HudOrb>
  );
}
