import * as React from "react";
import { Trans } from "@lingui/react/macro";
import { useAuth } from "@/lib/auth";
import { needsAbandonWarning } from "@/lib/abandonGuard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Guard = (targetGameId?: string) => Promise<boolean>;

const Ctx = React.createContext<Guard | null>(null);

/**
 * Guards the join/create actions that silently bot the user's seat in a live
 * game. `guard(targetGameId)` resolves true to proceed, false to abort. When no
 * warning is warranted it resolves immediately; otherwise it shows a single
 * shared confirmation dialog and resolves on the user's choice.
 */
export function AbandonGuardProvider({ children }: { children: React.ReactNode }) {
  const { me } = useAuth();
  const [open, setOpen] = React.useState(false);
  const resolveRef = React.useRef<((ok: boolean) => void) | null>(null);

  const settle = React.useCallback((ok: boolean) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(ok);
  }, []);

  const guard = React.useCallback<Guard>(
    (targetGameId) => {
      if (!needsAbandonWarning(me, targetGameId)) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setOpen(true);
      });
    },
    [me],
  );

  return (
    <Ctx.Provider value={guard}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && settle(false)}>
        <DialogContent className="w-auto max-w-90 flex flex-col gap-4">
          <DialogTitle>
            <Trans>Leave your current game?</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              A bot will take your seat. If it makes a move before you return, this game won't count
              toward your ranking.
            </Trans>
          </DialogDescription>
          <div className="flex items-center gap-2 justify-end">
            <Button size="sm" variant="secondary" onClick={() => settle(false)}>
              <Trans context="stay in the game you are already in">Stay</Trans>
            </Button>
            <Button size="sm" tone="danger" onClick={() => settle(true)}>
              <Trans>Leave &amp; continue</Trans>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

export function useAbandonGuard(): Guard {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useAbandonGuard must be used within AbandonGuardProvider");
  return ctx;
}
