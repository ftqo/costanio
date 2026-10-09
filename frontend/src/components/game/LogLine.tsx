import * as React from "react";
import { logParts, type LogLine, type LogMessage, type LogToken } from "@/lib/eventlog";
import { RES, COMMOD, resIconSlot, comIconSlot, goodCount } from "@/lib/cardFace";
import { useLingui } from "@lingui/react/macro";
// The runtime hook, not the macro: this file needs the active locale to
// re-render on, not a `t` tagged template.
import { useLingui as useLinguiRuntime } from "@/lib/linguiRuntime";
import {
  resourceText,
  commodityText,
  playedCardText,
  playedCardSlot,
  type CardKind,
  type CardText,
} from "@/lib/cardText";
import { ResIcon, CardFace } from "@/components/asset/AssetParts";
import { Die, EventDie } from "@/components/board/Die";
import { Tip } from "@/components/game/Tip";
import type { PieceIcons } from "@/lib/usePieceIcons";

/**
 * Drawing a log line: the one place that decides what a card looks like in text.
 * Sizes and caps are chosen for the log's box (300px x 180px on desktop, about
 * six rows); a taller card means a shorter history.
 */

/**
 * Cards and dice, sized to sit on a 12px line without growing the row. A card
 * is drawn on a tile of its own colour (see `Cards`): art 14, tile 18.
 */
const CARD_PX = 14;
const CARD_TILE_PX = 18;
const DIE_PX = 15;
/** Pieces run a little larger: they are read by silhouette, not by colour. */
const PIECE_PX = 18;

/**
 * How many cards are drawn before a count replaces them. At four, a bank trade
 * still shows its cards, and a nine-wheat Monopoly doesn't wrap the row; a
 * larger run becomes one card and a multiplier.
 */
const REPEAT_CAP = 4;

/**
 * Cards that left with nothing shown in return, drawn as spent. The line's verb
 * says "lost", so the dim is only a hint and kept light enough to stay legible.
 */
const LOSS_OPACITY = 0.82;

/**
 * A run of one card face, explained on hover. The icons only help once you
 * know the shapes, so the run carries a `Tip` naming the card and what it is
 * spent on. `Tip` rather than native `title`, which is slow and unstyled.
 */
function Cards({
  slot,
  n,
  label,
  text,
  color,
  loss,
  cap = REPEAT_CAP,
}: {
  slot: string;
  n: number;
  label: string;
  text?: CardText;
  color: string;
  loss?: boolean;
  /** Cards drawn before a count replaces them; see REPEAT_CAP. */
  cap?: number;
}) {
  const { t } = useLingui();
  const repeat = Math.min(n, cap);
  // "Wood ×2", not "2 Wood": a count before a translated name needs agreement
  // the name can't supply (2 Ziegel, 2 Schafe). It also matches what the run
  // draws past the repeat cap. See lib/cardFace.goodCount.
  const tally = goodCount(label, n);
  const caption = loss ? t`Lost ${tally}` : tally;
  // Each card stands on a tile of its own colour: the art's near-ink outline
  // dissolves on the dark panel, and the card tokens are theme-independent.
  // The border keeps the tile visible on the light panel (a bare fill fails 3:1).
  //
  // The art sits directly on the fill with no light well, unlike the hand's
  // card: an 18px tile has 15px of interior, and a well would shrink the colour
  // to a ring.
  const icon = (key: number) => (
    <span
      key={key}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-ink"
      style={{ background: color, width: CARD_TILE_PX, height: CARD_TILE_PX }}
    >
      <ResIcon slot={slot} size={CARD_PX} fallback={<span>{label}</span>} />
    </span>
  );
  // tabIndex -1: the run takes hover but not a tab stop (`Tip` defaults to 0),
  // or dozens of runs would bury the panel's controls. Named cards keep theirs.
  const run = (
    <span
      tabIndex={-1}
      aria-label={caption}
      className="inline-flex items-center gap-0.5 outline-none"
      style={loss ? { opacity: LOSS_OPACITY } : undefined}
    >
      {Array.from({ length: repeat }, (_, i) => icon(i))}
      {n > cap && <span className="text-muted font-num tabular-nums">×{n}</span>}
    </span>
  );
  if (!text) return run;
  return (
    // A card run has no action to collide with, so a plain tap opens it on a
    // screen with no hover. Watching opponents' turns in the log is when new
    // players learn.
    <Tip title={caption} hint={text.hint} tapToOpen>
      {run}
    </Tip>
  );
}

/**
 * A dev, progress or Raiders card, named in the line and explained on hover.
 * Underlined (dotted) rather than coloured, since the log uses colour for seats.
 */
function CardName({ kind, id }: { kind: CardKind; id: string }) {
  const text = playedCardText(kind, id);
  if (!text.hint) return <span className="font-extrabold">{text.name}</span>;
  // The card face above the sentence: the face answers "which card", the
  // sentence "what it does". Sentence alone when the pack has no face.
  const face = (
    <span className="flex flex-col items-center gap-1.5">
      <CardFace
        slot={playedCardSlot(kind, id)}
        className="block h-auto w-26 rounded-[5px] border border-border"
      />
      <span>{text.hint}</span>
    </span>
  );
  return (
    <Tip title={text.name} hint={face} tapToOpen>
      <span className="cursor-help font-extrabold underline decoration-dotted underline-offset-2 outline-none">
        {text.name}
      </span>
    </Tip>
  );
}

/**
 * A board piece, photographed from the game's own model in its owner's colour.
 *
 * Falls back to nothing: the line already names what was built, so a client
 * with no WebGL (or a render not yet resolved) just loses an ornament, where a
 * grey placeholder would read as nobody's piece. No `title`: the sentence
 * already names the piece.
 */
function Piece({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <img
      src={url}
      width={PIECE_PX}
      height={PIECE_PX}
      alt=""
      className="inline-block align-[-0.3em]"
    />
  );
}

/**
 * The card half of a token, drawn the same wherever cards are named. Exported
 * so the chat feed uses the same tile; chat lays its line out inline, but a
 * card is a card.
 */
export function CardToken({
  tok,
  cap,
}: {
  tok: Extract<LogToken, { k: "res" | "com" }>;
  cap?: number;
}) {
  const res = tok.k === "res";
  const face = res ? RES[tok.idx - 1] : COMMOD[tok.idx];
  if (!face) return null;
  return (
    <Cards
      slot={res ? resIconSlot(tok.idx) : comIconSlot(tok.idx)}
      n={tok.n}
      label={face.name}
      text={res ? resourceText(tok.idx) : commodityText(tok.idx)}
      color={face.color}
      loss={tok.loss}
      cap={cap}
    />
  );
}

function Token({
  tok,
  colorOf,
  pieceIcon,
}: {
  tok: LogToken;
  colorOf: (seat: number) => string;
  pieceIcon: PieceIcons;
}) {
  switch (tok.k) {
    case "t":
      return (
        <span className={tok.dim ? "text-muted font-num tabular-nums" : undefined}>{tok.s}</span>
      );
    case "res":
    case "com":
      return <CardToken tok={tok} />;
    case "die":
      return <Die n={tok.n} variant={tok.red ? "red" : "white"} size={DIE_PX} />;
    case "edie":
      return <EventDie face={tok.face} size={DIE_PX} />;
    case "piece":
      return <Piece url={pieceIcon(colorOf(tok.seat), tok.piece)} />;
    case "card":
      return <CardName kind={tok.kind} id={tok.id} />;
  }
}

/**
 * One log line. `flex-wrap` with a gap rather than inline text, so cards don't
 * butt against words. Icons have explicit sizes, so the row has its final
 * height on first paint and stick-to-bottom scrolling doesn't fight late art.
 */
export function LogTokens({
  line,
  colorOf,
  pieceIcon,
}: {
  line: LogLine;
  colorOf: (seat: number) => string;
  pieceIcon: PieceIcons;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 leading-[1.35]">
      {line.map((tok, i) => (
        <React.Fragment key={i}>
          <Token tok={tok} colorOf={colorOf} pieceIcon={pieceIcon} />
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * One line of the event log: a translated sentence with its pictures in it.
 *
 * The row draws the pieces in the order the sentence gives them; where a card
 * falls is the language's business. `logParts` returns them in the active
 * locale's order.
 *
 * Same wrapper, gap and line height as `LogTokens`; `flex-wrap` lets longer
 * languages (German runs ~30% long) take a second row.
 */
export function LogSentence({
  line,
  colorOf,
  pieceIcon,
}: {
  line: LogMessage;
  colorOf: (seat: number) => string;
  pieceIcon: PieceIcons;
}) {
  // Subscribes the row to language changes: the lines are cached per event
  // (lib/eventlog's `describedLines`), so nothing else would notice. `LogRow`
  // is memoised, so this runs once per row per language.
  const { i18n } = useLinguiRuntime();
  const parts = logParts(line, i18n);
  return (
    <span className="flex flex-wrap items-center gap-x-1 gap-y-0.5 leading-[1.35]">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {"run" in part ? (
            part.run.map((tok, j) => (
              <Token key={j} tok={tok} colorOf={colorOf} pieceIcon={pieceIcon} />
            ))
          ) : "dim" in part ? (
            <span className="text-muted font-num tabular-nums">{part.dim}</span>
          ) : (
            <span>{part.text}</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}
