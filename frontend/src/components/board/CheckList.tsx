import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import type { CheckResult } from "@/lib/preview/checks";

/** One row of the checks panel. */
export function CheckRow({ result }: { result: CheckResult }) {
  const mark = result.status === "fail" ? "✕" : result.status === "pass" ? "✓" : "•";
  const tone =
    result.status === "fail"
      ? "border-red text-red-ink"
      : result.status === "pass"
        ? "border-line text-foreground"
        : "border-line text-muted";
  return (
    <div
      data-check={result.id}
      data-status={result.status}
      className={`rounded-[10px] border-2 px-2.5 py-1.5 ${tone}`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-[12px] font-extrabold w-3 shrink-0">{mark}</span>
        <span className="text-[12px] font-extrabold">{result.label}</span>
      </div>
      <div className="mt-0.5 text-[10px] font-semibold leading-[1.35] text-muted">
        {result.detail}
      </div>
    </div>
  );
}

/**
 * The geometry checks over a dealt board: heading, failing count, one row per
 * check, and a button that copies the report.
 */
export function CheckList({
  results,
  onReport,
  reported,
}: {
  results: readonly CheckResult[];
  onReport: () => void;
  reported: boolean;
}) {
  const failures = results.filter((r) => r.status === "fail").length;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <div className="text-[12px] font-semibold text-muted">
          <Trans>Checks</Trans>
        </div>
        <div
          className={`text-[11px] font-extrabold ${failures ? "text-red-ink" : "text-muted"}`}
          data-testid="check-summary"
        >
          {failures ? (
            <Trans>{failures} failing</Trans>
          ) : results.length ? (
            <Trans>all clear</Trans>
          ) : null}
        </div>
      </div>
      {results.map((r) => (
        <CheckRow key={r.id} result={r} />
      ))}
      <Button variant="secondary" size="sm" onClick={onReport} data-testid="copy-report">
        {reported ? <Trans>Copied</Trans> : <Trans>Report</Trans>}
      </Button>
    </div>
  );
}
