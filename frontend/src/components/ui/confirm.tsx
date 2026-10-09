import * as React from "react";
import { useLingui } from "@lingui/react/macro";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isDismissed, dismiss } from "@/lib/dismissed";

// Promise-based replacement for window.confirm (the app uses no native
// dialogs). Mount <ConfirmProvider> once near the root; `await confirm({...})`
// returns true (confirmed) or false (cancelled or dismissed).

export interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** "danger" gives the confirm button the destructive (red) treatment. */
  tone?: "default" | "danger";
  /**
   * Offer "Don't show this again", remembered under this key (see lib/dismissed).
   *
   * Once remembered, `confirm` resolves true without opening. Use it only for
   * advice, never for a destructive confirm. Only confirming remembers;
   * cancelling with the box ticked does not.
   */
  suppressKey?: string;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLingui();
  const [pending, setPending] = React.useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  // Ticked in this dialog; reset on every open.
  const [dontAskAgain, setDontAskAgain] = React.useState(false);

  const confirm = React.useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        if (opts.suppressKey && isDismissed(opts.suppressKey)) {
          resolve(true);
          return;
        }
        setDontAskAgain(false);
        setPending({ opts, resolve });
      }),
    [],
  );

  // Resolve the outstanding promise and close. Idempotent if already settled.
  const settle = (value: boolean) => {
    setPending((p) => {
      if (p?.opts.suppressKey && value && dontAskAgain) dismiss(p.opts.suppressKey);
      p?.resolve(value);
      return null;
    });
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) settle(false);
        }}
      >
        {pending && (
          <DialogContent className="w-100">
            <DialogTitle>{pending.opts.title}</DialogTitle>
            {pending.opts.body && (
              <DialogDescription className="mt-1.5">{pending.opts.body}</DialogDescription>
            )}
            {pending.opts.suppressKey && (
              <label className="flex items-center gap-2 mt-3 text-[12px] font-semibold text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="confirm-dont-ask"
                  data-ui-checkbox=""
                  className="size-3.5 accent-green cursor-pointer"
                  checked={dontAskAgain}
                  onChange={(e) => setDontAskAgain(e.target.checked)}
                />
                {t`Don't show this again`}
              </label>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button size="sm" variant="secondary" onClick={() => settle(false)}>
                {pending.opts.cancelText ?? t`Cancel`}
              </Button>
              <Button
                size="sm"
                tone={pending.opts.tone === "danger" ? "danger" : undefined}
                onClick={() => settle(true)}
              >
                {pending.opts.confirmText ?? t`Confirm`}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
