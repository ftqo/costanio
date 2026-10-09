import { HEX_CLIP } from "@/lib/board";

/** A flat colored hex (mode thumbnail / preview), no outline. */
export function MiniHex({
  cell,
  w,
  h,
}: {
  cell: { left: number; top: number; color: string };
  w: number;
  h: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: cell.left,
        top: cell.top,
        width: w,
        height: h,
        background: cell.color,
        clipPath: HEX_CLIP,
      }}
    />
  );
}
