import * as React from "react";
import { cn } from "@/lib/utils";
import { PieceArt } from "./PieceIcon";

/**
 * One opponent, offered as a choice: their settlement in their colour, in a
 * ring of that colour, with their name under it. Used by every "pick a player"
 * prompt (robber and pirate steal, knight chase, Deserter, Spy, Master
 * Merchant), because on the board a player is their pieces.
 *
 * The settlement is the one piece every seat has in every ruleset. `PieceArt`
 * is the same model render the status panel and shop tiles use.
 */
export function SeatChoice({
  seat,
  name,
  color,
  detail,
  disabled,
  title,
  onSelect,
}: {
  seat: number;
  name: string;
  color: string;
  /** The one number this particular prompt turns on (VP, cards held, ...). */
  detail?: React.ReactNode;
  disabled?: boolean;
  title?: string;
  onSelect: (seat: number) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={() => onSelect(seat)}
      className={cn(
        // 44px floor on the tap target.
        "hud-seatpick hud-pc flex flex-col items-center gap-1.5 px-2.5 pt-2 pb-1.5 min-w-[68px]",
        disabled ? "opacity-40 cursor-default" : "cursor-pointer",
      )}
      // `--pc` feeds `.hud-pc`, which gives the ring the seat's ink: yellow
      // becomes gold on the pale panel and blue lifts on the smoked one.
      style={{ ["--pc" as string]: color }}
    >
      {/* The ring carries the seat colour at full strength; the well behind the
          piece stays light so a dark seat colour still reads as a silhouette
          (as ResCard does for its icons). */}
      <span className="hud-seatpick-well relative flex items-center justify-center w-11 h-11">
        <span className="w-7 h-7">
          <PieceArt piece="settlement" color={color} />
        </span>
      </span>
      {/* Two lines rather than an ellipsis: bot names run to two words ("Bot
          Camembert"), and the cut-off part is what tells bots apart. A single
          word longer than the box still breaks. */}
      <span
        data-seat-choice-name
        className="text-[12px] font-semibold leading-tight max-w-[88px] text-center line-clamp-2 break-words"
      >
        {name}
      </span>
      {detail != null && (
        <span className="font-num text-[10px] font-medium text-muted leading-none">{detail}</span>
      )}
    </button>
  );
}

/** The row every seat prompt lays its choices out in, so they all match. */
export function SeatChoiceRow({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-center flex-wrap">{children}</div>;
}
