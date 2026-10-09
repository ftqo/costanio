import * as React from "react";
import { Trans } from "@lingui/react/macro";
import { ScrollFade } from "@/components/ui/scroll-fade";
import { GLASS } from "./HudLayer";
import type { StickyScroll } from "@/lib/stickyScroll";
import { cn } from "@/lib/utils";

/**
 * The table feed: the event log or the table chat, as one surface showing one
 * of them.
 *
 * Each has its own control at every size (two orbs in the top-right row on a
 * desktop, two buttons above the hotbar on a phone), raising its pane directly;
 * pressing the lit one puts it away. The unread dot is on the chat control. The
 * same behaviour at every width, so it is learned once.
 *
 * The composer belongs to the chat pane only.
 *
 * Log and chat rows arrive already rendered: each is a projection of socket
 * data Game.tsx owns (describeEvent, moderation state, seat colours).
 */
/**
 * The rows inside a pane, held against its bottom edge. Both feeds read
 * newest-last and are pinned to the bottom by lib/stickyScroll, so a pane with
 * few rows looks like a feed that hasn't filled yet.
 *
 * `mt-auto` rather than `justify-end` on the scroll box: an auto margin is the
 * one way to bottom-align in a scroll container without putting overflowing top
 * rows out of scroll reach.
 */
function FeedRows({ children }: { children: React.ReactNode }) {
  return <div className="mt-auto flex flex-col gap-0">{children}</div>;
}

/** What makes a scroll box a running commentary. See the header on TableFeed. */
const FEED_REGION = (labelledBy: string) =>
  ({
    role: "log",
    "aria-live": "polite",
    "aria-relevant": "additions",
    "aria-atomic": "false",
    "aria-labelledby": labelledBy,
  }) as const;

/**
 * Live-region attributes, so the event log (lib/eventlog's sentence per event)
 * and chat are announced to screen readers.
 *
 * `role="log"` rather than bare `aria-live`: order matters and the newest is
 * last. `aria-relevant="additions"` keeps old rows being trimmed
 * (lib/fadingLog) from being read; `aria-atomic="false"` stops a new row
 * re-reading the rest.
 *
 * It goes on the scroll box, ScrollFade's inner element (see `scrollProps`),
 * not the wrapper, whose fade gradients and nudge arrows would be announced.
 *
 * The island keeps both panes mounted and swaps a `hidden` class; a
 * `display: none` subtree isn't exposed, so only the pane on screen narrates,
 * and narration stops when the surface is put away.
 */
export function TableFeed({
  pane,
  log,
  chat,
  chatBar,
  logScroll,
  chatScroll,
  onChatRead,
  variant = "island",
  rootRef,
}: {
  /** Which half this surface is. The host owns it; there is no switch in here. */
  pane: "log" | "chat";
  log: React.ReactNode;
  chat: React.ReactNode;
  chatBar: React.ReactNode;
  /**
   * Where each pane is scrolled to, and whether it is following. Owned by the
   * host (see Game.tsx), since this surface mounts and unmounts with its
   * control and the position must outlive it.
   */
  logScroll: StickyScroll<HTMLDivElement>;
  chatScroll: StickyScroll<HTMLDivElement>;
  /** Called while the chat pane is actually on screen, so unread can clear. */
  onChatRead?: () => void;
  /**
   * "sheet" drops the island's own glass and fixed width and fills its parent:
   * the dock presentation, a panel raised from above the hotbar.
   */
  variant?: "island" | "sheet";
  /**
   * Files the surface under a HUD anchor: an opponent's revealed card settles
   * toward the log, whose line carries the face (CardRevealLayer).
   */
  rootRef?: (el: HTMLElement | null) => void;
}) {
  const sheet = variant === "sheet";
  // The heading names both panes' boxes; only one is ever displayed, so the id
  // is never claimed twice.
  const headingId = React.useId();

  // Whatever is visible counts as read. This component exists only while its
  // control is on, so switching it off lets unread accumulate.
  const chatVisible = pane === "chat";
  React.useEffect(() => {
    if (chatVisible) onChatRead?.();
  }, [chatVisible, onChatRead, chat]);

  // Only this component knows which pane is on screen, and the scroll boxes
  // need it to open on their newest row. The DOM can't tell us cheaply: being
  // raised is sometimes a mount (the dock panel) and sometimes an un-hide (the
  // island swaps `hidden`), and a `display: none` box measures 0 everywhere and
  // ignores writes.
  //
  // A layout effect, so the pin lands in the frame the pane appears (no flash of
  // the top of the log), and its scrollHeight read sees the panel's final
  // height, including the visual-viewport cap that keeps the composer above
  // the keyboard (lib/hudChrome), applied in the same commit. The cleanup
  // covers the panel being put away.
  //
  // Both objects are identity-stable (lib/stickyScroll memoises them), so this
  // runs only on those two events, not every websocket frame.
  React.useLayoutEffect(() => {
    logScroll.setVisible(pane === "log");
    chatScroll.setVisible(pane === "chat");
    return () => {
      logScroll.setVisible(false);
      chatScroll.setVisible(false);
    };
  }, [pane, logScroll, chatScroll]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex flex-col gap-1.5",
        sheet
          ? "w-full min-h-0 flex-1"
          : cn(
              GLASS,
              "w-[300px] max-w-[calc(100vw-var(--hud-inset,0.5rem)*2)] px-2.5 pt-2.5 pb-2 gap-1.5",
              // Content-sized, and yields when the column is short: the island
              // shares the HUD's right-hand column with the bank card above,
              // which keeps its natural height (see lib/hudChrome). The pane
              // below sizes to its rows up to a cap. `min-h-0` lets the pane give
              // rows back; the header and composer can't shrink.
              "min-h-0",
            ),
      )}
    >
      {/* A label naming the pane the outside controls chose; not a control. */}
      {/* Caps come from CSS; index.css turns that off for CJK locales. */}
      {/* An `h2` (the game view's title is the h1): it names the log below and
          gives screen-reader users a landmark to jump to. */}
      <h2 id={headingId} className="hud-lab shrink-0 px-1.5">
        {pane === "chat" ? <Trans>Table chat</Trans> : <Trans>Event log</Trans>}
      </h2>

      {/* Both panes get the same box, so switching doesn't resize the island,
          and both stay mounted so a switch is a class change rather than a
          rebuild. Each opens on its newest row, as on a phone, where the two
          are separate dock panels.

          The number is a flex base size in both directions: `grow` spends the
          definite height the host hands down, and a cap above (the dock panel's
          measured height, or the island's reserve, see lib/hudChrome) shrinks
          this pane and nothing else, the only child allowed under its content.

          `svh` is the right base but the wrong cap: it doesn't move when the
          on-screen keyboard appears, so the binding cap comes from the visual
          viewport, one level up. */}
      {/* The island's pane is content-sized between a floor and a cap: a new
          game's log is a few lines, and a long one scrolls. It grows upward from
          the composer at the island's foot, so the header moves, not anything
          under the pointer. */}
      <div
        className={cn(
          "flex flex-col min-h-0",
          sheet ? "h-[42svh]" : "min-h-[78px] max-h-[min(300px,40svh)]",
        )}
      >
        <ScrollFade
          scrollRef={logScroll.ref}
          onScroll={logScroll.onScroll}
          scrollProps={FEED_REGION(headingId)}
          wrapperClassName={cn("flex-col min-h-0 flex-1", pane === "log" ? "flex" : "hidden")}
          className="no-scrollbar flex-1 overflow-y-auto flex flex-col min-h-0"
        >
          <FeedRows>{log}</FeedRows>
        </ScrollFade>
        <ScrollFade
          scrollRef={chatScroll.ref}
          onScroll={chatScroll.onScroll}
          scrollProps={FEED_REGION(headingId)}
          wrapperClassName={cn("flex-col min-h-0 flex-1", pane === "chat" ? "flex" : "hidden")}
          className="no-scrollbar flex-1 overflow-y-auto flex flex-col min-h-0"
        >
          <FeedRows>{chat}</FeedRows>
        </ScrollFade>
      </div>
      {/* The composer keeps its height while the pane above gives rows back:
          it must stay reachable when squeezed. */}
      {pane === "chat" && <div className="shrink-0">{chatBar}</div>}
    </div>
  );
}
