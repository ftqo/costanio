import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { CircleNotch } from "@/lib/icons";
import { Trans, useLingui } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGameSocket, gameSocket } from "@/lib/ws";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

// RankedQueueProvider owns the ranked matchmaking queue app-wide so the search
// survives navigation: the lobby button calls joinRanked(), a persistent toast
// shows the live status with a Cancel, and a match-found socket push drops the
// player into their waiting room from wherever they are.

// Descriptors, not strings: a module constant would freeze the language active
// at import. Same context as the leaderboard's tabs.
const QUEUE_LABEL: Record<string, MessageDescriptor> = {
  base: msg({ message: "Base", context: "ruleset name" }),
  cak: msg({ message: "Knights", context: "ruleset name" }),
};

interface RankedQueueApi {
  queue: string | null; // the queue key currently searching, or null
  joinRanked: (queue: string) => Promise<void>;
  cancel: () => Promise<void>;
}

const Ctx = React.createContext<RankedQueueApi | null>(null);

export function RankedQueueProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { me } = useAuth();
  // This provider wraps the whole app, so subscribe only to the match-found push.
  const matchGame = useGameSocket((s) => s.matchGame);
  const toast = useToast();
  const [queue, setQueue] = React.useState<string | null>(null);
  const [pool, setPool] = React.useState(0);
  const [secs, setSecs] = React.useState(0);

  // Restore an in-progress search from the server on load, so the toast
  // survives a reload. Registered users only; the endpoint 401s guests.
  React.useEffect(() => {
    if (!me || me.guest) return;
    let cancelled = false;
    api
      .rankedStatus()
      .then((st) => {
        if (!cancelled && st.queued) {
          setQueue(st.queue);
          setPool(st.pool);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [me?.id, me?.guest]); // eslint-disable-line react-hooks/exhaustive-deps

  // While queued: poll the server for pool size (and to detect a server-side
  // dequeue) every 3s, and tick the elapsed clock every second.
  React.useEffect(() => {
    if (!queue) return;
    const pollId = window.setInterval(() => {
      void (async () => {
        try {
          const st = await api.rankedStatus();
          setPool(st.pool);
          if (!st.queued) setQueue(null);
        } catch {
          // Transient; keep the toast up until the next successful poll.
        }
      })();
    }, 3000);
    const tickId = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => {
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, [queue]);

  // A match-found push arrives over the session socket; navigate into it. The
  // effect keys on the pushed id, and consumeMatch clears it straight off the
  // store (never through React), so exactly one caller navigates.
  React.useEffect(() => {
    const g = gameSocket.consumeMatch();
    if (g) {
      setQueue(null);
      void navigate({ to: "/lobby", search: { g } });
    }
  }, [matchGame, navigate]);

  const joinRanked = React.useCallback(
    async (q: string) => {
      gameSocket.ensureOpen(); // ensure we'll receive the match-found push
      setSecs(0);
      setPool(0);
      try {
        await api.rankedJoin(q);
        setQueue(q);
      } catch {
        toast.error(t`Couldn't join the ranked queue.`);
      }
    },
    [toast, t],
  );

  const cancel = React.useCallback(async () => {
    setQueue(null);
    try {
      await api.rankedLeave();
    } catch {
      // best-effort: the toast is already gone
    }
  }, []);

  const value = React.useMemo<RankedQueueApi>(
    () => ({ queue, joinRanked, cancel }),
    [queue, joinRanked, cancel],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {queue && (
        <RankedQueueToast
          queue={queue}
          pool={pool}
          secs={secs}
          onCancel={() => {
            void cancel();
          }}
        />
      )}
    </Ctx.Provider>
  );
}

export function useRankedQueue(): RankedQueueApi {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useRankedQueue must be used within a RankedQueueProvider");
  return ctx;
}

function fmtElapsed(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// RankedQueueToast is the singleton persistent status card. It sits bottom-left
// so it never collides with the transient (bottom-right) error/info Toaster.
function RankedQueueToast({
  queue,
  pool,
  secs,
  onCancel,
}: {
  queue: string;
  pool: number;
  secs: number;
  onCancel: () => void;
}) {
  const { i18n } = useLingui();
  const label = QUEUE_LABEL[queue] ? i18n._(QUEUE_LABEL[queue]) : queue;
  const elapsed = fmtElapsed(secs);
  return (
    <div className="fixed bottom-4 left-4 z-60 w-65 border-2 border-border bg-secondary-background rounded-[20px] shadow-hard-lg p-4 text-foreground">
      <div className="flex items-center gap-2 text-[15px] font-extrabold">
        <CircleNotch weight="bold" className="animate-spin text-purple shrink-0" />
        <Trans>Searching ranked</Trans>
      </div>
      {/* One message, so translations control the separators and order. */}
      <div className="mt-0.5 text-[13px] font-semibold text-muted">
        <Trans>
          {label} · {elapsed} · {pool} in queue
        </Trans>
      </div>
      <Button tone="danger" size="sm" className="mt-3 w-full" onClick={onCancel}>
        <Trans context="stop searching for a ranked match">Cancel</Trans>
      </Button>
    </div>
  );
}
