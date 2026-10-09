import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DiceFive } from "@/lib/icons";

/** How the roll balances the board: the same two modes a lobby offers. */
export type RollMode = "fair" | "random";

/** Generation controls shared by the sidebar and fullscreen preview. */
export interface SeedControlsProps {
  /** Roll resources, numbers and deserts onto the shape (ports come with them). */
  onRandomizeResources: () => void;
  /** Tiles still waiting for the roll: the first roll reads as Generate, not Randomize. */
  blanks: boolean;
  disabled: boolean;
  busy: boolean;
}

/** Generate or randomize the board. */
export function SeedControls({ compact, ...p }: SeedControlsProps & { compact?: boolean }) {
  const cannot = p.disabled || p.busy;
  return (
    <div className={compact ? "flex items-center gap-2 flex-wrap" : "flex flex-col gap-2"}>
      {/* The panel's main action: the green primary. */}
      <Button
        tone="accent"
        disabled={cannot}
        onClick={p.onRandomizeResources}
        data-testid="randomize"
        className={compact ? "" : "w-full"}
      >
        <DiceFive weight="bold" size={16} />
        {p.blanks ? <Trans>Generate board</Trans> : <Trans>Randomize resources</Trans>}
      </Button>
    </div>
  );
}

export interface GeneratePanelProps {
  seeds: SeedControlsProps;
  centerDesert: boolean;
  onCenterDesertChange: (on: boolean) => void;
  rollMode: RollMode;
  onRollModeChange: (m: RollMode) => void;
}

/** Generation options and action, beneath the editor tools. */
export function GeneratePanel({
  seeds,
  centerDesert,
  onCenterDesertChange,
  rollMode,
  onRollModeChange,
}: GeneratePanelProps) {
  return (
    <div
      data-panel="generate"
      className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-2"
    >
      <div className="text-[12px] font-semibold text-muted">
        <Trans context="map builder panel heading">Generate</Trans>
      </div>

      {/* desert placement */}
      <label className="flex items-start gap-2.5 rounded-base bg-elev px-3 py-2.5 cursor-pointer">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold">
            <Trans>Desert in the middle</Trans>
          </div>
          <div className="mt-0.5 text-[13px] leading-[1.4] text-muted">
            <Trans>
              One desert on the centre tile, like the standard board. Off, the roll puts the deserts
              where it likes.
            </Trans>
          </div>
        </div>
        <div className="shrink-0 pt-0.5">
          <Switch
            checked={centerDesert}
            onCheckedChange={onCenterDesertChange}
            data-testid="center-desert"
          />
        </div>
      </label>

      {/* balance */}
      <div className="flex gap-1.5">
        {(["fair", "random"] as const).map((m) => (
          <button
            key={m}
            type="button"
            data-rollmode={m}
            onClick={() => onRollModeChange(m)}
            className={`flex-1 border rounded-base px-3 py-1 text-[12px] font-semibold ${rollMode === m ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"}`}
          >
            {m === "fair" ? (
              <Trans context="board roll mode">Balanced</Trans>
            ) : (
              <Trans context="board roll mode">Random</Trans>
            )}
          </button>
        ))}
      </div>

      <SeedControls {...seeds} />

      <div className="text-[13px] text-muted leading-[1.45]">
        <Trans>
          Rolls resources, numbers and harbours onto the shape; water and gold stay. To hand
          somebody the exact board you have, use Share a code.
        </Trans>
      </div>
    </div>
  );
}
