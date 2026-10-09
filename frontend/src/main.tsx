// Must be the first import: it opens the session websocket when it evaluates.
// ES modules evaluate depth-first in import order, so this starts the
// handshake ahead of the ~700ms the rest of the graph takes to evaluate.
// lib/preconnect.test.ts fails if it is moved or dropped.
import "@/lib/preconnect";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { ErrorBoundary } from "@/lib/ErrorBoundary";
import { LocaleProvider } from "@/lib/LocaleProvider";
import { AbandonGuardProvider } from "@/components/AbandonGuard";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmProvider } from "@/components/ui/confirm";
import { router } from "@/router";
import "animate.css";
import "./index.css";
// Punchboard area stylesheets, after index.css so they win the cascade.
import "./styles/pb-primitives.css";
import "./styles/pb-hud.css";
import "./styles/pb-modules.css";
import "./styles/pb-site.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Outermost, so a thrown render shows the fallback instead of an empty
        <div id="root">. Outside LocaleProvider because a catalogue that fails
        to load is one of the failures it handles, so its copy is
        untranslated. */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Above everything that renders text, so the first paint is already
              in the right language. */}
          <LocaleProvider>
            <AbandonGuardProvider>
              <ToastProvider>
                <ConfirmProvider>
                  <RouterProvider router={router} />
                </ConfirmProvider>
              </ToastProvider>
            </AbandonGuardProvider>
          </LocaleProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
