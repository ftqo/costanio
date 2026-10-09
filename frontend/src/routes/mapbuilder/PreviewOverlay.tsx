import * as React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { CheckList } from "@/components/board/CheckList";
import { X } from "@/lib/icons";
import { reportJSON } from "@/lib/preview/checks";
import { SeedControls, type SeedControlsProps } from "./GeneratePanel";
import type { BoardPreview } from "./useBoardPreview";

// The board renderer is the whole three.js chunk, so it loads the first time
// the preview opens rather than with the page (most visits only paint a
// shape).
const Board3D = React.lazy(() =>
  import("@/components/board/Board3D").then((m) => ({ default: m.Board3D })),
);

export interface PreviewOverlayProps {
  preview: BoardPreview;
  ruleset: string;
  seeds: SeedControlsProps;
  busy: boolean;
  playLabel: React.ReactNode;
  playDisabled: boolean;
  onPlay: () => void;
  onClose: () => void;
}

/**
 * The full-screen preview: the board the table would be dealt, drawn by the
 * game's renderer with the chosen expansions, plus a seed stepper, the
 * geometry checks in a side panel, and Play. Escape or the corner button
 * returns to the editor with the board intact.
 */
export function PreviewOverlay({
  preview,
  ruleset,
  seeds,
  busy,
  playLabel,
  playDisabled,
  onPlay,
  onClose,
}: PreviewOverlayProps) {
  const { t } = useLingui();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [reported, setReported] = React.useState(false);
  function copyReport() {
    void navigator.clipboard
      ?.writeText(reportJSON(ruleset, preview.envelope?.seed ?? "", preview.results))
      .then(
        () => {
          setReported(true);
          window.setTimeout(() => setReported(false), 1200);
        },
        () => setReported(false),
      );
  }
  const failures = preview.results.filter((r) => r.status === "fail").length;
  const [checksOpen, setChecksOpen] = React.useState(false);

  return (
    <div
      data-preview-overlay
      role="dialog"
      aria-modal="true"
      aria-label={t`Board preview`}
      className="fixed inset-0 z-50 flex flex-col bg-ocean"
    >
      {/* top bar: seed, roll, play, close */}
      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-secondary-background border-b border-line shadow-hard">
        <div className="text-[16px] font-semibold mr-2">
          <Trans context="fullscreen board preview heading">Preview</Trans>
        </div>
        <SeedControls {...seeds} compact />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setChecksOpen((v) => !v)}
            aria-expanded={checksOpen}
            data-testid="toggle-checks"
          >
            <Trans>Checks</Trans>
            {preview.results.length > 0 && (
              <span
                className={`ml-1.5 text-[11px] ${failures ? "text-red-ink" : "text-muted"} font-semibold`}
              >
                {failures ? <Trans>{failures} failing</Trans> : <Trans>all clear</Trans>}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            disabled={playDisabled || busy}
            onClick={onPlay}
            data-testid="preview-play"
          >
            {playLabel}
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t`Back to the editor`}
            title={t`Back to the editor (Esc)`}
            onClick={onClose}
            data-testid="close-preview"
          >
            <X weight="bold" size={16} />
          </Button>
        </div>
      </div>

      {/* the board, edge to edge */}
      <div className="relative flex-1 min-h-0">
        {preview.view && (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <Board3D
              view={preview.view}
              mode="none"
              markerStyle="none"
              flagHexes={preview.flagged}
              className="w-full h-full"
              controls
            />
          </React.Suspense>
        )}
        {(preview.loading || preview.error || busy) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {preview.error && !busy ? (
              <div className="pointer-events-auto text-[13px] font-semibold text-red-ink px-6 text-center bg-secondary-background border border-rim shadow-hard rounded-card py-2">
                {preview.error}
              </div>
            ) : (
              <Spinner />
            )}
          </div>
        )}
        {checksOpen && (
          <div className="absolute top-3 right-3 w-75 max-h-[calc(100%-24px)] overflow-y-auto rounded-card border border-rim shadow-hard bg-secondary-background p-3">
            <CheckList results={preview.results} onReport={copyReport} reported={reported} />
          </div>
        )}
        <div className="absolute bottom-3 left-3 right-3 text-center text-[10px] font-semibold text-main-foreground/90 pointer-events-none">
          <Trans>
            The board as a table would be dealt it, with the chosen expansions laid over it.
            Resources, numbers and harbours are yours to keep; expansion layers are dealt again when
            the game starts.
          </Trans>
        </div>
      </div>
    </div>
  );
}
