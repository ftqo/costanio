import { ResIcon } from "@/components/asset/AssetParts";
import { RES, resIconSlot } from "@/lib/cardFace";

/**
 * The resources a purchase needs, as small icon+count pairs: the price of one
 * entry in the location menu (the build shelf uses full `ResCard`s).
 *
 * It doesn't mark which resource you are short of; the readout already says
 * "You need 1 more ore." in words.
 *
 * As on the resource cards, a count appears only above one, so a 1-wood
 * 1-brick road reads as two plain chips.
 */
export function CostChips({ cost, size = 13 }: { cost: Record<number, number>; size?: number }) {
  return (
    <span className="flex items-center gap-1" data-cost="">
      {RES.filter((r) => cost[r.idx]).map((r) => (
        <span key={r.idx} data-res={r.idx} className="flex items-center gap-0.5">
          <ResIcon slot={resIconSlot(r.idx)} size={size} />
          {cost[r.idx] > 1 && (
            <span className="text-[10px] font-extrabold leading-none">{cost[r.idx]}</span>
          )}
        </span>
      ))}
    </span>
  );
}
