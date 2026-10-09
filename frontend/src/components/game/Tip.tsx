import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { zoomFactor, toLayoutSize, layoutViewport } from "@/lib/zoom";
import { placeTooltip, type Box } from "@/lib/floating";
import {
  useNoHover,
  useLongPress,
  LONG_PRESS_CSS,
  LONG_PRESS_MS,
  type LongPressHandlers,
} from "@/lib/touch";
import { useExplaining, answerGiven } from "@/lib/explainMode";

/**
 * How long after a press a focus still counts as part of that press. Focus
 * follows a press within a frame or two; a quarter of a second is far shorter
 * than a deliberate Tab.
 */
const FOCUS_AFTER_PRESS_MS = 250;

/**
 * On a device with no hover, a focus shows the tip only if a key was pressed
 * this recently. A dialog focuses its first control on open (lib/dialog
 * `initialFocus`), and on a phone that would leave a tip stuck over the
 * dialog. A tablet's hardware keyboard still works, since Tab arrives as a
 * keydown first.
 */
const FOCUS_AFTER_KEY_MS = 1000;
let lastKeyAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener(
    "keydown",
    () => {
      lastKeyAt = Date.now();
    },
    true,
  );
}

/**
 * The ring a trigger gets when this component put it in the tab order (a
 * component that hands out focus should draw it). Placed before the child's
 * classes so a caller can override it, and it survives `outline-none`: it is a
 * box-shadow, which tailwind-merge keeps separate from outline.
 */
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-border";

/** Does this subtree render any text of its own? */
function hasText(node: React.ReactNode): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim() !== "";
  if (typeof node === "number") return true;
  if (Array.isArray(node)) return node.some(hasText);
  if (React.isValidElement(node))
    return hasText((node.props as { children?: React.ReactNode }).children);
  return false;
}

/**
 * Is this child a control, something whose visible text a voice user says?
 * Only DOM tags can be answered; a component child might render anything, so
 * it counts as interactive. Wrongly declining to name something is cheaper than
 * overriding a real control's visible label (WCAG 2.5.3).
 */
function interactive(el: React.ReactElement): boolean {
  const tag = el.type;
  if (typeof tag !== "string") return true;
  if (tag === "a" || tag === "area") return "href" in (el.props as object);
  return /^(button|input|select|textarea|summary)$/.test(tag);
}

/** The open tip's closer: at most one tip is ever showing. See `show`. */
let current: (() => void) | null = null;

/** The trigger's box in layout (zoom-normalized) px, or null with no trigger. */
function triggerBox(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const z = zoomFactor();
  const r = el.getBoundingClientRect();
  return {
    left: r.left / z,
    top: r.top / z,
    right: r.right / z,
    bottom: r.bottom / z,
    width: r.width / z,
    height: r.height / z,
  };
}

// A small tooltip that explains a thing, instead of the browser's native
// `title`. This is the app's one hint primitive; route every explanatory hint
// through it. Renders into a portal so scroll/overflow containers can't clip it,
// and clamps to every viewport edge.
//
// Positioning is two-phase: capture the trigger box on show, then measure the
// rendered tip and place it (hidden until measured, so no first-frame flash).
//
// Three ways in, depending on the pointer:
//
//   Hover, where there is hover. Ephemeral: it closes when the pointer leaves.
//
//   Long press, where there isn't. Sticky: it stays until dismissed, since the
//   thumb lifting shouldn't take the answer away. This is what WCAG 2.1 1.4.13
//   asks of hint content (dismissable, hoverable, persistent).
//
//   A single tap, while explain mode is armed, or on a trigger that declares its
//   tap inert (`tapToOpen`). Sticky too. Never otherwise: most triggers commit
//   an action, and a tap must not both act and explain.
//
// A sticky tip closes on a press elsewhere, Escape, a scroll, or pressing the
// same trigger again.
//
// Screen readers: a string `title` becomes the trigger's accessible name
// (`aria-describedby` alone is not a name). It does not create tab stops; a
// trigger that wants one passes `focusable`, and gets it only if it will have a
// name to announce.
export function Tip({
  title,
  note,
  hint,
  children,
  className,
  tapToOpen,
  focusable,
}: {
  title: React.ReactNode;
  note?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactElement;
  className?: string;
  /**
   * A plain tap opens this tip, on a pointer with no hover. Only for triggers
   * whose tap does nothing else (a score, a counter, a resource chip, a rating
   * badge); leave it off anything that acts. Long press and the explain orb
   * still reach it.
   */
  tapToOpen?: boolean;
  /**
   * Put a non-interactive trigger in the tab order, so its tip can be reached
   * with Tab. For an information-only chip (a counter, an award) that has a
   * name, either its own `aria-label` or one supplied from a string `title`.
   * Ignored without a name. Controls need nothing here.
   */
  focusable?: boolean;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);
  // The trigger's box in layout (zoom-normalized) px, set while the tip is open.
  const [anchor, setAnchor] = React.useState<Box | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  // Opened by a deliberate gesture, so it outlives the gesture.
  const [sticky, setSticky] = React.useState(false);
  const noHover = useNoHover();
  const explaining = useExplaining();
  const id = React.useId();

  // `zoomFactor` is called rather than aliased into a local: an alias reads as
  // a reactive value to the deps lint, and a module import can't change.
  //
  // Measured in visual px, consumed as layout px; see lib/zoom.
  const hide = React.useCallback(() => {
    setAnchor(null);
    setPos(null);
    setSticky(false);
    if (current === hideRef.current) current = null;
  }, []);
  // A stable handle on `hide` for the module's one-open-tip slot to compare.
  const hideRef = React.useRef(hide);

  const show = React.useCallback((stick = false) => {
    const box = triggerBox(ref.current);
    if (!box) return;
    // One tip at a time. Opening this one closes whichever was open, sticky or
    // not: a trigger that moves or re-renders out from under the pointer never
    // fires its leave.
    if (current && current !== hideRef.current) current();
    current = hideRef.current;
    setAnchor(box);
    setPos(null); // re-measure on the next layout pass
    if (stick) setSticky(true);
  }, []);

  // Unmounting while open frees the slot rather than leaving a dead closer.
  React.useEffect(
    () => () => {
      if (current === hideRef.current) current = null;
    },
    [],
  );

  /**
   * Hover's exit, which a sticky tip ignores. Reads through the setter rather
   * than `sticky` so the callback keeps its identity and the child isn't
   * re-cloned each render.
   */
  const hoverOut = React.useCallback(() => {
    setSticky((s) => {
      if (!s) {
        setAnchor(null);
        setPos(null);
        if (current === hideRef.current) current = null;
      }
      return s;
    });
  }, []);

  const openSticky = React.useCallback(() => {
    // A second press on the same trigger closes what it opened.
    if (sticky) {
      hide();
      return;
    }
    show(true);
    // The mode got its answer, so it stands down (see lib/explainMode).
    if (explaining) answerGiven();
  }, [sticky, hide, show, explaining]);

  const { handlers, pressing } = useLongPress(openSticky, { enabled: noHover });

  /**
   * When a pointer last went down on this trigger, so the focus handler can tell
   * a Tab from a tap that moved focus as a side effect. A ref, since it is
   * written in one event and read in the next.
   */
  const pressedAt = React.useRef(0);

  // Explain mode makes a tap an opener on every pointer (a mouse user who armed
  // it asked for that too). `tapToOpen` is coarse-only, since a hover already
  // answers on the pointers that have one.
  const tapOpens = explaining || (tapToOpen && noHover);

  React.useLayoutEffect(() => {
    if (!anchor || !tipRef.current) return;
    const z = zoomFactor();
    const tr = tipRef.current.getBoundingClientRect();
    const p = placeTooltip(
      anchor,
      toLayoutSize(tr, z),
      // Layout px, not innerWidth/innerHeight (visual px), or a tip near the
      // right or bottom edge overshoots by the zoom factor.
      layoutViewport(z),
    );
    setPos({ left: p.left, top: p.top });
  }, [anchor]);

  /**
   * While open, re-read the trigger on every resize (a phone rotating, a window
   * narrowed) and re-place when the tip's own box changes size (a count ticking
   * over, a font arriving). An open tip can outlive the pointer via keyboard
   * focus or a sticky tap.
   */
  const open = anchor !== null;
  React.useEffect(() => {
    if (!open) return;
    const reanchor = () => {
      const box = triggerBox(ref.current);
      if (box) setAnchor(box);
    };
    window.addEventListener("resize", reanchor);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reanchor);
    if (ro && tipRef.current) ro.observe(tipRef.current);
    return () => {
      window.removeEventListener("resize", reanchor);
      ro?.disconnect();
    };
  }, [open]);

  // The three dismissals a sticky tip needs. Capture phase on the press, so the
  // tip closes before whatever is underneath acts on the same gesture; `scroll`
  // is captured too, since it doesn't bubble out of an inner scroller.
  React.useEffect(() => {
    if (!sticky) return;
    const onDown = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (ref.current?.contains(t) || tipRef.current?.contains(t))) return;
      hide();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, [sticky, hide]);

  const childProps = children.props as {
    className?: string;
    tabIndex?: number;
    style?: React.CSSProperties;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    children?: React.ReactNode;
  } & Record<string, unknown>;

  /**
   * The name, for an icon-only control (`aria-describedby` can't be one).
   *
   * Applied only when the trigger has no name of its own (a caller that named
   * it meant it), the title is a string (only a string can be a name, as in
   * Stat's `srName`), and the trigger has no text inside (replacing a control's
   * visible label breaks WCAG 2.5.3).
   *
   * Not applied to a bare `<span>`: a name on an element with no role is
   * ignored (see Stat's `role="img"`). A chip that wants a name adds the role
   * itself; Tip can't add it blind without hiding the wrapper's contents.
   */
  const ownName = childProps["aria-label"] ?? childProps["aria-labelledby"];
  const supplied =
    !ownName && typeof title === "string" && interactive(children) && !hasText(childProps.children)
      ? title
      : undefined;

  /**
   * Spread, never set: `cloneElement` merges by key and an explicit `undefined`
   * is still a key, so `"aria-label": undefined` would delete the child's own.
   */
  const naming = supplied ? { "aria-label": supplied } : {};
  // A stop the caller asked for, that the child hasn't decided for itself, and
  // that will announce something.
  const stop = focusable && childProps.tabIndex === undefined && (ownName || supplied);

  /**
   * Ours after theirs. `cloneElement` replaces the child's handlers, which is
   * fine for the hover pair (this component owns those) but would break a
   * trigger that tracks its own presses (dock tiles, anything draggable).
   */
  function chain<K extends keyof LongPressHandlers>(key: K): LongPressHandlers[K] {
    const theirs = childProps[key as string] as ((e: never) => void) | undefined;
    const ours = handlers[key];
    if (!theirs) return ours;
    return ((e: never) => {
      theirs(e);
      (ours as (e: never) => void)(e);
    }) as LongPressHandlers[K];
  }

  // Spread rather than set: an explicit `onClick: undefined` would delete the
  // child's handler (on a ProgressCardChoice button, the one that plays the
  // card). The tip sets a click only when it claims it.
  const claimClick = tapOpens
    ? {
        onClick: (e: React.MouseEvent) => {
          // In explain mode the tap is a question and must not also act. A
          // `tapToOpen` trigger has no action, but stopping keeps the paths
          // identical.
          e.preventDefault();
          e.stopPropagation();
          openSticky();
        },
      }
    : {};

  const trigger = React.cloneElement(children, {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      pressedAt.current = Date.now();
      chain("onPointerDown")(e);
    },
    onPointerMove: chain("onPointerMove"),
    onPointerUp: chain("onPointerUp"),
    onPointerCancel: chain("onPointerCancel"),
    onContextMenu: chain("onContextMenu"),
    // Not chained: this one exists to stop the click, so running the child's
    // capture handler first would defeat it.
    onClickCapture: handlers.onClickCapture,
    // Hover events only where hover is real; on a coarse pointer they fire once
    // on touchdown and never leave.
    onPointerEnter: noHover ? undefined : () => show(),
    onPointerLeave: noHover ? undefined : hoverOut,
    // Focus, except when it is the press already being handled.
    //
    // On a touchscreen a tap focuses the trigger, and a plain `onFocus` would
    // show a tip that never closes. Not `:focus-visible`: engines implement it
    // differently and jsdom always reports false, which would drop the keyboard
    // hint. Instead: this component saw the pointer go down, so a focus within a
    // moment of that is the press; anything else (Tab, a switch, a programmatic
    // focus) shows the tip.
    onFocus: () => {
      if (Date.now() - pressedAt.current < FOCUS_AFTER_PRESS_MS) return;
      if (noHover && Date.now() - lastKeyAt > FOCUS_AFTER_KEY_MS) return;
      show();
    },
    onBlur: hoverOut,
    ...claimClick,
    ...naming,
    ...(stop ? { tabIndex: 0 } : {}),
    "aria-describedby": anchor ? id : undefined,
    className: cn(
      stop && FOCUS_RING,
      childProps.className,
      noHover && LONG_PRESS_CSS,
      // The hold, made visible as it happens, so a player who lifts too soon
      // sees something began. Transform only, so no layout cost.
      pressing && "scale-95 transition-transform ease-out",
    ),
    style: pressing
      ? { ...childProps.style, transitionDuration: `${LONG_PRESS_MS}ms` }
      : childProps.style,
  } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> });

  return (
    <>
      {trigger}
      {anchor &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className={cn(
              // HUD tokens, though the tip is portalled to <body> outside
              // HudLayer.
              "hud-root fixed z-[200] max-w-55",
              // An ephemeral tip mustn't eat the pointer (it sits under the
              // cursor that raised it). A sticky one may be pressed inside, and
              // the containment check above keeps those presses from counting
              // as "outside".
              sticky ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              left: pos ? pos.left : -9999,
              top: pos ? pos.top : -9999,
              visibility: pos ? "visible" : "hidden",
            }}
          >
            <div className={cn("hud-surf-solid rounded-lg px-2.5 py-1.5 text-left", className)}>
              {/* Standing facts (how many are left in a deck, what the next
                  level grants) go above the heading in their own band with a
                  rule under it, so the popover ends on its price. Negative
                  margins take the rule to the tip's edges. */}
              {note && (
                <div className="-mx-2.5 mb-1 border-b border-line px-2.5 pb-1 text-[10.5px] font-medium leading-snug text-muted">
                  {note}
                </div>
              )}
              <div className="text-[12px] font-semibold leading-tight text-foreground">{title}</div>
              {hint && (
                <div className="mt-0.5 text-[11px] font-normal leading-snug text-muted">{hint}</div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
