import * as React from "react";
import { createPortal } from "react-dom";
import { useLingui } from "@lingui/react/macro";
import { Warning, Info, X } from "@/lib/icons";

// Lightweight toast system (sonner-shaped API, no deps). Mount <ToastProvider>
// once near the root and call useToast() anywhere. Toasts stack bottom-right,
// slide in and auto-dismiss.

type Variant = "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  variant: Variant;
}

interface ToastApi {
  show: (message: string, variant?: Variant) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

/**
 * How far above the bottom edge the stack sits, in layout pixels, to clear
 * whatever a screen pins there. Zero leaves the usual 16px corner. The game
 * screen passes its bottom row's height (see `useToastInset`) so toasts do not
 * cover the dice and End turn.
 */
const ToastInsetContext = React.createContext<((px: number) => void) | null>(null);

/** The gap left between a cleared bottom row and the lowest toast. */
export const TOAST_INSET_GAP = 12;

/**
 * Keep toasts clear of a row pinned to the bottom of the screen for as long as
 * the calling component is mounted. `px` is that row's height (0 while it is
 * not yet measured, which leaves the stack in its corner).
 */
export function useToastInset(px: number) {
  const set = React.useContext(ToastInsetContext);
  React.useEffect(() => {
    if (!set) return;
    set(px);
    return () => set(0);
  }, [set, px]);
}

const DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const [inset, setInset] = React.useState(0);
  const nextId = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const show = React.useCallback(
    (message: string, variant: Variant = "info") => {
      const id = nextId.current++;
      setToasts((ts) => [...ts, { id, message, variant }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const api = React.useMemo<ToastApi>(
    () => ({ show, error: (m) => show(m, "error"), info: (m) => show(m, "info") }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      <ToastInsetContext.Provider value={setInset}>
        {children}
        <Toaster toasts={toasts} inset={inset} onDismiss={dismiss} />
      </ToastInsetContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

/**
 * Two live regions, both always mounted. A live region only announces changes
 * made after it exists, so a role on each new toast would never be read.
 *
 * Errors go in `role="alert"` and everything else in `role="status"`. Two
 * regions rather than one with swapped politeness, because `aria-live` is read
 * when the region is created. `aria-atomic="false"` on both, since
 * `role="alert"` implies atomic and would re-read earlier errors.
 *
 * The groups stack separately, so an info toast raised after an error sits
 * above it. An empty region takes no space.
 */
function Toaster({
  toasts,
  inset,
  onDismiss,
}: {
  toasts: ToastItem[];
  inset: number;
  onDismiss: (id: number) => void;
}) {
  if (typeof document === "undefined") return null;
  const region = (variant: Variant, role: "status" | "alert") => (
    <div role={role} aria-atomic="false" className="flex flex-col gap-2">
      {toasts
        .filter((t) => t.variant === variant)
        .map((t) => (
          <Toast key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
        ))}
    </div>
  );
  return createPortal(
    <div
      data-toast-stack
      // Bottom-centre on a landscape phone, where the bottom-right corner is
      // the dock's dice and End turn.
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[min(360px,calc(100vw-2rem))] pointer-events-none squat:right-auto squat:left-1/2 squat:-translate-x-1/2"
      style={inset > 0 ? { bottom: inset + TOAST_INSET_GAP } : undefined}
    >
      {region("info", "status")}
      {region("error", "alert")}
    </div>,
    document.body,
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { t } = useLingui();
  const Icon = toast.variant === "error" ? Warning : Info;
  return (
    // No role: the region it lands in has one (see `Toaster`).
    <div
      data-ui-toast={toast.variant}
      // A solid panel. An error carries its icon in a red disc; the text stays
      // ink for readability.
      className="pointer-events-auto flex items-start gap-2.5 rounded-base border border-rim px-3.5 py-3 shadow-hard-lg animate-toast-in bg-secondary-background text-foreground"
    >
      {toast.variant === "error" ? (
        <span
          data-ui-toast-icon=""
          className="shrink-0 -mt-px -ml-0.5 size-5.5 rounded-full bg-btn-danger text-btn-danger-ink flex items-center justify-center"
        >
          <Icon weight="bold" size={13} />
        </span>
      ) : (
        <Icon weight="bold" size={18} className="shrink-0 mt-px text-muted" />
      )}
      <div className="text-[13px] font-medium leading-snug flex-1 min-w-0 break-words">
        {toast.message}
      </div>
      <button
        onClick={onDismiss}
        aria-label={t`Dismiss`}
        // 21px button. On touch the hit area grows 16px per side (53px, or
        // 40px under the landscape-phone zoom).
        className="relative shrink-0 -mr-1 -mt-1 p-1 rounded-full text-muted hover:text-foreground hover:bg-elev cursor-pointer pointer-coarse:before:absolute pointer-coarse:before:-inset-4 pointer-coarse:before:content-['']"
      >
        <X weight="bold" size={13} />
      </button>
    </div>
  );
}
