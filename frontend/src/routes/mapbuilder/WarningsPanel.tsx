import type { Hex, MapIssue } from "@/lib/types";
import { mapIssueText } from "@/lib/errorCopy";
import { Trans } from "@lingui/react/macro";

export interface WarningsPanelProps {
  issues: MapIssue[];
  onHighlight: (hexes: Hex[]) => void;
}

export function WarningsPanel({ issues, onHighlight }: WarningsPanelProps) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const sorted = [...errors, ...warnings];

  return (
    <div className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-1.5">
      <div className="text-[12px] font-semibold text-muted">
        <Trans context="map builder panel heading">Issues</Trans>
      </div>
      {issues.length === 0 && (
        <div className="text-[13px] font-semibold text-green-ink">
          <Trans>✓ No issues, looks balanced</Trans>
        </div>
      )}
      {sorted.map((issue, idx) => (
        <button
          key={idx}
          type="button"
          onMouseEnter={() => onHighlight(issue.hexes)}
          onMouseLeave={() => onHighlight([])}
          onClick={() => onHighlight(issue.hexes)}
          // Rounded print rows inside the rounded panel, a fill on hover.
          className="flex items-start gap-2 text-left text-[13px] py-1.5 px-2 -mx-2 rounded-base hover:bg-elev2 cursor-pointer"
        >
          <span
            className={`mt-0.5 shrink-0 inline-block w-2 h-2 rounded-full ${issue.severity === "error" ? "bg-red" : "bg-amber"}`}
          />
          <span className={issue.severity === "error" ? "text-red-ink" : "text-foreground"}>
            {mapIssueText(issue.code, issue.params)}
          </span>
        </button>
      ))}
    </div>
  );
}
