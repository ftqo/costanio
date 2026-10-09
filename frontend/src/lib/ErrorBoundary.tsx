/**
 * Top-level error boundary, so a thrown render shows a message and a reload
 * button instead of a blank page.
 *
 * Mounted outside LocaleProvider, so its copy is untranslated English: a
 * catalogue that failed to load is one of the failures it must survive. The
 * layout uses inline styles so it needs no Tailwind pass; colours are theme
 * tokens, which fall back to black on white with no stylesheet.
 *
 * A boundary only catches render throws, not rejected promises in effects
 * (see lib/LocaleProvider for that case).
 */
import * as React from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The console is the frontend's only reporting channel. Keep the component
    // stack, which a minified trace lacks.
    console.error("[boundary] unhandled render error", error, info.componentStack);
  }

  override render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    // A panel (one piece) on the page ground, inline-styled for the reason
    // above. Every value is a theme token, so it follows the site's faces,
    // ground and piece edge; with no stylesheet they fall back to plain text.
    return (
      <div
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          background: "var(--color-background)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            maxWidth: "28rem",
            width: "100%",
            padding: "1.75rem",
            borderRadius: "12px",
            background: "var(--secondary-background)",
            color: "var(--foreground)",
            boxShadow: "var(--pb-piece)",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.375rem",
              fontWeight: "var(--font-weight-heavy, 700)",
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            Something went wrong.
          </h1>
          <p style={{ margin: 0, lineHeight: 1.55, fontSize: "0.875rem", color: "var(--muted)" }}>
            The page hit an error it could not recover from. Reloading usually fixes it. If it keeps
            happening, the console has the details.
          </p>
          <div style={{ marginTop: "0.5rem" }}>
            {/* The site's primary Button: the green affirmative piece. */}
            <Button tone="accent" size="sm" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
