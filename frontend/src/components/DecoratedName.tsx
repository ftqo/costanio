import * as React from "react";
import { decorationFor } from "@/lib/decorations";

// usePrefersReducedMotion tracks the OS "reduce motion" setting so the
// decoration can swap its animated GIF for a static still.
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

// DecoratedName renders a username with its equipped name decoration (an
// animated GIF behind the text). When `decoration` is empty/unknown it renders a
// plain span, so it's safe to use everywhere a name appears.
export function DecoratedName({
  decoration,
  className,
  children,
}: {
  decoration?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const fx = decorationFor(decoration, reduced);
  const cls = [className, fx?.className].filter(Boolean).join(" ");
  return <span className={cls || undefined}>{children}</span>;
}

/**
 * A decoration on its own: a small swatch of the effect, for a chip or a list
 * row that labels it in plain text beside it. A name drawn through the effect
 * at chip size reads as struck through, so chips never do that.
 */
export function DecorationPreview({
  decoration,
  className,
}: {
  decoration: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const fx = decorationFor(decoration, reduced);
  if (!fx) return null;
  const cls = ["inline-block shrink-0 w-6 h-4 rounded-xs bg-elev2", fx.className, className]
    .filter(Boolean)
    .join(" ");
  return <span aria-hidden data-decoration-preview="" className={cls} />;
}
