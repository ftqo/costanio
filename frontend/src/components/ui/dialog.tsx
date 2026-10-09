import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

// The two text roles of a dialog. A call site picks a size.
const dialogTitleVariants = cva("font-display font-bold", {
  variants: {
    size: {
      // A question the player must answer: confirms, leave/surrender prompts.
      md: "text-[17px]",
      // A panel with its own controls: settings, your seat.
      lg: "text-[18px]",
      // The store's full-width shelf.
      xl: "text-[20px]",
    },
  },
  defaultVariants: { size: "md" },
});

export interface DialogTitleProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>,
    VariantProps<typeof dialogTitleVariants> {}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  DialogTitleProps
>(({ className, size, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(dialogTitleVariants({ size }), className)}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

const dialogDescriptionVariants = cva("text-muted", {
  variants: {
    size: {
      // The consequence line under a question.
      md: "text-[13px] font-semibold",
      // A blurb under a panel's title.
      prose: "text-[14px]",
      // A footnote at the bottom of a panel.
      note: "text-[12px] leading-[1.45]",
    },
  },
  defaultVariants: { size: "md" },
});

export interface DialogDescriptionProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>,
    VariantProps<typeof dialogDescriptionVariants> {}

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  DialogDescriptionProps
>(({ className, size, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn(dialogDescriptionVariants({ size }), className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    {/* No open/close animation: the animate-in/out classes need a Tailwind
        plugin this project does not install. */}
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(8_14_26/0.45)]" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Solid panel, soft deep lift, 1px rim, no outline.
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 border border-rim bg-secondary-background rounded-card shadow-hard-lg p-5 text-foreground focus-visible:outline-none max-w-[94vw] max-h-[90vh] overflow-y-auto",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";
