import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { seatSurface } from "@/lib/color";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-extrabold transition-all select-none cursor-pointer border disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        // The one filled action. The fill comes from the tone (amber for
        // default, accent and success; red for danger). `shadow-shadow` is the
        // theme's lift token; the HUD restyles it (`.hud-root [data-ui-button]`).
        primary: "border-btn-rim shadow-shadow",
        // A quiet control on a panel: surface fill, 1px rim, small lift.
        secondary: "bg-secondary-background text-foreground border-border shadow-shadow",
        // No surface of its own until hovered; inline low-stakes actions.
        quiet: "bg-panel text-muted border-transparent hover:bg-panel2",
        // Transparent until hovered: toolbar and header actions.
        ghost: "bg-transparent text-foreground border-transparent",
      },
      // Accent fills set their own text colour so callers never write text-white.
      // On the site, accent and success both use the amber action; the HUD keeps
      // them blue and green (see .hud-root).
      tone: {
        default: "",
        accent: "bg-btn-accent text-btn-accent-ink",
        danger: "bg-btn-danger text-btn-danger-ink",
        success: "bg-btn-success text-btn-success-ink",
        discord: "bg-discord text-main-foreground",
        // White with dark text per Google's brand guidelines, in both themes.
        google: "bg-google-surface text-google-ink",
      },
      size: {
        sm: "px-4 py-1.5 text-[13px]",
        // Attached to a text field (Load beside a map code, Save beside a
        // name): sm's type and height on a tighter side padding.
        field: "px-3 py-1.5 text-[13px]",
        md: "px-5 py-2.5 text-[15px]",
        lg: "px-7 py-3 text-[17px]",
        icon: "h-7 w-7 p-0",
      },
      // Draws the control radius token: 10px on the site, fully round in the HUD.
      pill: {
        true: "rounded-control",
        false: "rounded-base",
      },
      /**
       * Let the label wrap instead of overflowing the button.
       *
       * The base is `whitespace-nowrap`. In a grid cell or capped flex row a
       * nowrap label cannot shrink and draws outside the border, which happens
       * with longer translations (the Spanish for "Boost to unlock" is 34
       * characters, in a ~180px store card). Use it wherever the button does
       * not choose its own width.
       * Opt-in because a global change would reshape every button.
       */
      wrap: {
        true: "whitespace-normal text-balance",
        false: "",
      },
      // On: the ink fill a selected Pill uses.
      pressed: {
        true: "bg-selected text-selected-ink",
        false: "",
      },
    },
    // The default primary with no tone is the amber action.
    compoundVariants: [
      { variant: "primary", tone: "default", className: "bg-btn-primary text-btn-primary-ink" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      pill: true,
      tone: "default",
      wrap: false,
      pressed: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Fill this button with an arbitrary colour (a seat or resource colour) and
   * pick a readable label colour automatically. Use this instead of
   * `style={{ background }}` plus a hand-picked text colour.
   */
  fill?: string;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, pill, tone, wrap, pressed, fill, asChild = false, style, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    // `pressed` is a toggle's state, so it is announced as one. The selected
    // look keys off `aria-pressed` (pb-primitives.css), so the two cannot
    // disagree; a caller's own `aria-pressed` still wins.
    const ariaPressed = props["aria-pressed"] ?? (pressed == null ? undefined : pressed);
    return (
      <Comp
        ref={ref}
        // The HUD restyles the button through this (`.hud-root [data-ui-button]`).
        data-ui-button=""
        data-variant={variant ?? "primary"}
        data-pill={pill === false ? "false" : undefined}
        aria-pressed={ariaPressed}
        className={cn(buttonVariants({ variant, size, pill, tone, wrap, pressed }), className)}
        style={fill ? { ...seatSurface(fill), ...style } : style}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };

/**
 * A `Button`'s look for an element that cannot be one (a new-tab link, a span
 * inside a file label): the classes and the data attributes `Button` sets.
 * The hover, press and HUD styles key off `[data-ui-button]`, so the classes
 * alone are not enough.
 */
export function buttonLook(opts: VariantProps<typeof buttonVariants> = {}): {
  className: string;
  "data-ui-button": "";
  "data-variant": string;
} {
  return {
    className: buttonVariants(opts),
    "data-ui-button": "",
    "data-variant": opts.variant ?? "primary",
  };
}
