import * as React from "react";
import { cn } from "@/lib/utils";

// A dropdown positioned with plain CSS (position: absolute) rather than a JS
// positioner. Fixed positioning plus getBoundingClientRect double-applies under
// a CSS `zoom` ancestor; absolute positioning stays correct when the UI is zoomed.

/**
 * Closing, as the menu's rows call it.
 *
 * `focusTrigger` defaults true: choosing a row unmounts the focused element,
 * and focus would otherwise fall back to `<body>`. It is false when focus is
 * already going elsewhere (a click outside, a Tab to the next control).
 */
const MenuCloseCtx = React.createContext<(focusTrigger?: boolean) => void>(() => {});

// Arrow-key navigation for the menu (`role="menu"` implies Up/Down).
//
// Not roving tabindex: every row stays a tab stop and the arrows are added on
// top, so Tab behaves as it does elsewhere in the app.
//
// Bound on the root, not the panel, so an arrow pressed while focus is still on
// the trigger (at < 0) is handled. Only rows carry the role, so
// `querySelectorAll` finds only rows.
function menuArrowKeys(e: React.KeyboardEvent<HTMLDivElement>) {
  const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  const home = e.key === "Home";
  const end = e.key === "End";
  if (!dir && !home && !end) return;
  const items = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
  );
  if (items.length === 0) return;
  e.preventDefault();
  const at = items.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLElement);
  // Wraps, and an arrow pressed with focus still on the trigger (at === -1)
  // enters the list from the end it points at.
  const to = home
    ? 0
    : end
      ? items.length - 1
      : at < 0
        ? dir > 0
          ? 0
          : items.length - 1
        : (at + dir + items.length) % items.length;
  items[to]?.focus();
}

let menuSeq = 0;

export function Menu({
  trigger,
  triggerClassName,
  triggerLabel,
  children,
  align = "end",
  contentClassName,
  className,
  shadow = true,
}: {
  trigger: React.ReactNode;
  triggerClassName?: string;
  /**
   * The trigger's accessible name, for a trigger that is only a picture (an
   * icon, an avatar). Without one it is announced as a bare "button".
   */
  triggerLabel?: string;
  children: React.ReactNode;
  align?: "start" | "end";
  contentClassName?: string;
  className?: string;
  // The dropdown has a hard shadow by default. tailwind-merge does not
  // recognise the custom shadow token, so contentClassName cannot override it.
  shadow?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [menuId] = React.useState(() => `menu-${++menuSeq}`);
  /**
   * Which end of the list an arrow-key opening lands on, or null when the menu
   * was opened by a press and focus stays on the trigger. A ref because the
   * keydown writes it and the next commit's effect reads it.
   */
  const enterAt = React.useRef<"first" | "last" | null>(null);

  const close = React.useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  // An arrow that opened the menu also steps into it. This waits for the
  // commit because the rows do not exist during the keydown.
  React.useLayoutEffect(() => {
    if (!open || !enterAt.current) return;
    const rows = ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
    const at = enterAt.current;
    enterAt.current = null;
    rows?.[at === "first" ? 0 : rows.length - 1]?.focus();
  }, [open]);

  // A press outside closes without taking focus back, since focus is already
  // moving where the player chose. Escape is handled on the root below, so it
  // only reaches the menu that has focus.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      onKeyDown={(e) => {
        // Stop propagation so a menu behind this one does not close too.
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close();
          return;
        }
        menuArrowKeys(e);
      }}
      // Tabbing out closes the menu. There is no focus trap: every row is a tab
      // stop, so Tab walks the list and then leaves. This also keeps two menus
      // from being open at once.
      onBlur={(e) => {
        if (open && !ref.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        data-ui-menu-trigger=""
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          // Down and Up open the menu on the end they point at. The layout
          // effect above does the stepping.
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            e.stopPropagation(); // the root's handler must not step again
            enterAt.current = e.key === "ArrowDown" ? "first" : "last";
            setOpen(true);
          }
        }}
        className={cn("cursor-pointer", triggerClassName)}
      >
        {trigger}
      </button>
      {open && (
        <MenuCloseCtx.Provider value={close}>
          <div
            id={menuId}
            role="menu"
            // The HUD keeps the panel's 2px edge and padding (index.css, site-material block).
            data-ui-menu=""
            className={cn(
              // Solid panel, 1px rim, deep soft lift.
              "absolute top-full mt-2 z-50 min-w-55 border border-rim bg-secondary-background rounded-card p-1.5 text-foreground flex flex-col gap-0.5",
              shadow && "shadow-hard-lg",
              align === "end" ? "right-0" : "left-0",
              contentClassName,
            )}
          >
            {children}
          </div>
        </MenuCloseCtx.Provider>
      )}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  asChild,
  keepOpen,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  asChild?: boolean;
  keepOpen?: boolean;
  tone?: "default" | "danger";
  className?: string;
}) {
  const close = React.useContext(MenuCloseCtx);
  const cls = cn(
    // A row is plain text until hovered or focused, then a neutral well; the
    // icon takes the ink. `danger` rows keep red text and icon.
    "flex items-center gap-2.5 px-2.5 py-2 text-[14px] font-bold rounded-lg outline-none cursor-pointer transition-colors [&_svg]:text-muted",
    tone === "danger"
      ? "text-red-ink [&_svg]:text-red-ink hover:bg-red-tint focus-visible:bg-red-tint"
      : "hover:bg-elev focus-visible:bg-elev hover:[&_svg]:text-foreground focus-visible:[&_svg]:text-foreground",
    className,
  );
  const run = () => {
    onSelect?.();
    if (!keepOpen) close();
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      className?: string;
      onClick?: (e: React.MouseEvent) => void;
      role?: string;
      "data-ui-menu-item"?: string;
      "data-tone"?: string;
    }>;
    return React.cloneElement(child, {
      role: "menuitem",
      "data-ui-menu-item": "",
      "data-tone": tone,
      className: cn(cls, child.props.className),
      onClick: (e: React.MouseEvent) => {
        child.props.onClick?.(e);
        run();
      },
    });
  }
  // A real <button>, so Enter, Space and disabled work without a key handler.
  // `text-left` and `w-full` restore the block layout a div had.
  return (
    <button
      type="button"
      role="menuitem"
      data-ui-menu-item=""
      data-tone={tone}
      className={cn(cls, "w-full text-left")}
      onClick={run}
    >
      {children}
    </button>
  );
}

/**
 * A section heading inside a menu ("Account", a signed-in name): small muted
 * type that never reads as a row. Not focusable and not a menu item, so the
 * arrow keys step over it.
 */
export function MenuLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="presentation"
      data-ui-menu-label=""
      className={cn("px-2.5 pt-1.5 pb-0.5 text-xs font-bold text-muted select-none", className)}
    >
      {children}
    </div>
  );
}
