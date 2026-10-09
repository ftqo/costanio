import * as React from "react";
import { parseChatLine, hasCards, type ChatParseOptions } from "@/lib/chatTokens";
import { CardToken } from "@/components/game/LogLine";

/**
 * A chat message with its resources drawn as cards. The parse is in
 * lib/chatTokens; this only draws, and differs from the log in two ways:
 *
 * - Inline, not a flex row. A chat message continues a sentence that starts
 *   with the sender's name, so it flows as one wrapping paragraph, and the
 *   spacing is the sender's own (the parser keeps the original spacing).
 * - A longer run before a count. The log caps a run at four to save lines in
 *   its 180px box; chat draws five cards before a run collapses.
 */
const CHAT_REPEAT_CAP = 5;

export function ChatText({ msg, commodities }: { msg: string } & ChatParseOptions) {
  const line = React.useMemo(() => parseChatLine(msg, { commodities }), [msg, commodities]);
  // Nothing to draw: return the string itself rather than a span holding it.
  if (!hasCards(line)) return <>{msg}</>;
  return (
    <>
      {line.map((tok, i) =>
        tok.k === "t" ? (
          <React.Fragment key={i}>{tok.s}</React.Fragment>
        ) : tok.k === "res" || tok.k === "com" ? (
          // The tile is an 18px box on a ~16px line; without an explicit
          // baseline an inline-flex box aligns on the art's bottom and rides
          // high.
          <span key={i} className="inline-block align-[-0.35em]">
            <CardToken tok={tok} cap={CHAT_REPEAT_CAP} />
          </span>
        ) : null,
      )}
    </>
  );
}
