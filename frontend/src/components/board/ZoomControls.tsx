import { Plus, Minus } from "@/lib/icons";
import { useLingui } from "@lingui/react/macro";
import { Tip } from "@/components/game/Tip";
import { ResetView } from "@/components/game/hudIcons";

// Small zoom cluster overlaid on a board: zoom in / out / reset camera.
export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onReset,
  className = "",
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  className?: string;
}) {
  const { t } = useLingui();
  // Opaque, no backdrop-blur: nothing visible to blur at 28px, and each filtered
  // element costs a compositor surface.
  const btn =
    "w-7 h-7 rounded-lg border-2 border-border bg-secondary-background flex items-center justify-center shadow-hard-sm hover:brightness-95 active:translate-y-px";
  return (
    <div className={`absolute z-20 flex flex-col gap-1 ${className || "bottom-2 right-2"}`}>
      <Tip title={t`Zoom in`}>
        <button type="button" className={btn} onClick={onZoomIn}>
          <Plus weight="bold" size={14} />
        </button>
      </Tip>
      <Tip title={t`Zoom out`}>
        <button type="button" className={btn} onClick={onZoomOut}>
          <Minus weight="bold" size={14} />
        </button>
      </Tip>
      {/* Same reticle as the game HUD's reset orb, for the same "reset view" action. */}
      <Tip title={t`Reset view`}>
        <button type="button" className={btn} onClick={onReset}>
          <ResetView size={14} />
        </button>
      </Tip>
    </div>
  );
}
