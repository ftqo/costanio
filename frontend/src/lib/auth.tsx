import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiErr } from "./api";
import { gameSocket } from "./ws";
import { inActivityMode } from "./activity";
import { getBearer, ME_CACHE_KEY } from "./session";
import type { Me, SupporterView } from "./types";

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /**
   * Ensure the visitor has a session, minting a nameless guest if not. There
   * is no guest login prompt; guests name themselves in the waiting room.
   * Returns the resolved Me.
   */
  ensureSession: () => Promise<Me | null>;
  logout: () => Promise<void>;
  /** Local dev one-click registered login (GET /auth/dev). Full-page redirect. */
  devLogin: () => void;
  /**
   * Re-pull the caller's Discord role status without a re-login, so a role
   * granted via /setrole takes effect. force=true is the "sync roles" button
   * (unconditional, rate-limited); force=false is the TTL-gated path used on
   * focus and visibility changes.
   */
  refreshSupporter: (force?: boolean) => Promise<void>;
}

const Ctx = React.createContext<AuthCtx | null>(null);

// Cache the visitor's public `Me` (never a token; the session is an httpOnly
// cookie) so a returning user's profile renders on first paint instead of the
// logged-out header. The live check below reconciles it.
//
// ME_CACHE_KEY lives in lib/session because lib/preconnect reads the same
// cache before this module evaluates.

function loadCachedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Me) : null;
  } catch {
    return null; // unavailable or corrupt storage: fall back to a fresh check
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<Me | null>(loadCachedMe);
  const [loading, setLoading] = React.useState(true);
  const queryClient = useQueryClient();

  // Apply a fresh or pushed role status to the cached identity. Deduped
  // against the last applied view so an unchanged status does not refetch the
  // cosmetics catalogue. A real change updates the supporter badge and
  // invalidates ["cosmetics"] so newly unlocked decorations become selectable.
  // Own account only.
  const lastSupporter = React.useRef<string>("");
  const applySupporter = React.useCallback(
    (v: SupporterView) => {
      const key = JSON.stringify(v);
      if (key === lastSupporter.current) return;
      lastSupporter.current = key;
      setMe((prev) => (prev ? { ...prev, supporter: v.active } : prev));
      void queryClient.invalidateQueries({ queryKey: ["cosmetics"] });
    },
    [queryClient],
  );

  // Rejects on API error so the manual button can show feedback (e.g. the rate
  // limit). The automatic callers swallow rejections.
  const refreshSupporter = React.useCallback(
    async (force = false) => {
      applySupporter(force ? await api.refreshRoles() : await api.supporter());
    },
    [applySupporter],
  );

  // Live updates of the caller's own role status:
  //  - the server pushes supporter_updated over the game socket on any change,
  //  - focus or tab visibility re-pulls (TTL-gated),
  // which covers web tabs and the Discord Activity.
  React.useEffect(() => {
    gameSocket.setSupporterHandler(applySupporter);
    const onFocus = () => void refreshSupporter(false).catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshSupporter(false).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [applySupporter, refreshSupporter]);

  // Keep the cache in step with `me`: written on login or refresh, removed on
  // logout or when the server reports no session (see refresh).
  React.useEffect(() => {
    try {
      if (me) localStorage.setItem(ME_CACHE_KEY, JSON.stringify(me));
      else localStorage.removeItem(ME_CACHE_KEY);
    } catch {
      /* storage unavailable (private mode / quota); caching is best-effort */
    }
  }, [me]);

  const refresh = React.useCallback(async () => {
    try {
      // `session`, not `me`: it answers a visitor with 204 instead of a 401.
      setMe(await api.session());
    } catch (e) {
      // Only drop the cached identity on an explicit 401. On other errors keep
      // the optimistic value rather than flashing to logged-out.
      if (e instanceof ApiErr && e.status === 401) setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // In the Discord Activity there is no session until the SDK bootstrap
    // trades the OAuth code for a bearer (lib/activity.ts, driven by Root.tsx),
    // so skip the probe and let the bootstrap call refresh(). `loading` stays
    // true meanwhile, and Root shows the booting screen.
    if (inActivityMode() && !getBearer()) return;
    void refresh();
  }, [refresh]);

  // Mint a guest session on first need (joining or creating a table), so
  // guests never see a login prompt.
  const ensureSession = React.useCallback(async (): Promise<Me | null> => {
    if (me) return me;
    try {
      const current = await api.session();
      if (current) {
        setMe(current);
        return current;
      }
    } catch {
      /* the probe failed outright; try minting one below */
    }
    await api.anon();
    const fresh = await api.me();
    setMe(fresh);
    return fresh;
  }, [me]);

  const logout = React.useCallback(async () => {
    await api.logout();
    setMe(null);
  }, []);

  const devLogin = React.useCallback(() => {
    if (inActivityMode()) return;
    window.location.href = "/auth/dev";
  }, []);

  return (
    <Ctx.Provider
      value={{ me, loading, refresh, ensureSession, logout, devLogin, refreshSupporter }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
