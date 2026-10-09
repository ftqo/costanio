import { MiniHex } from "./Hex";

/** Renders a small cluster of flat hexes inside a fixed box, optionally scaled. */
export function HexCluster({
  cells,
  hexW,
  hexH,
  boxW,
  boxH,
  scale = 1,
}: {
  cells: { left: number; top: number; color: string }[];
  hexW: number;
  hexH: number;
  boxW: number;
  boxH: number;
  scale?: number;
}) {
  return (
    <div style={{ width: boxW * scale, height: boxH * scale }}>
      <div
        style={{
          position: "relative",
          width: boxW,
          height: boxH,
          transform: scale === 1 ? undefined : `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {cells.map((c, i) => (
          <MiniHex key={i} cell={c} w={hexW} h={hexH} />
        ))}
      </div>
    </div>
  );
}
