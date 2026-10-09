import * as React from "react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import {
  hexPolygon,
  hexCenter,
  boardViewBox,
  terrainFill,
  previewFill,
  hexKey,
  edgeKey,
  edgeEnds,
  edgeMid,
  harborLayouts,
} from "@/lib/hexgeo";
import { usePanZoom, BUILDER_MIN_ZOOM, BUILDER_DESIGN_ZOOM } from "@/components/board/usePanZoom";
import { ZoomControls } from "@/components/board/ZoomControls";
import { TokenChipArt, TokenLabel, portInfo } from "@/components/asset/slotArt";
import {
  applyDrag,
  setTileResource,
  pruneInlandHarbors,
  setTileNumber,
  canHoldNumber,
  addLand,
  removeLand,
  rectHexes,
  fitCanvas,
  MIN_CANVAS,
  MAX_CANVAS,
  DEFAULT_CANVAS,
  DESIGN_RESOURCES,
  PRODUCING,
  type DragLayer,
} from "@/lib/maps/board";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Boat, X } from "@/lib/icons";
import { canPlaceHarbor, coastEdges, setHarbor, type HarborBrush } from "@/lib/maps/harbors";
import type { Board, BoardTile, Edge, Hex, Resource, MapIssue } from "@/lib/types";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@/lib/linguiRuntime";
import { msg, plural, t } from "@lingui/core/macro";
import { i18n } from "@lingui/core";
import { ResIcon } from "@/components/asset/AssetParts";
import { assetURL } from "@/lib/assets";
import { RES, resIconSlot } from "@/lib/cardFace";
import type { MessageDescriptor } from "@lingui/core";

const S = 44; // board hex circumradius in svg units
const NUMBERS = [2, 3, 4, 5, 6, 12, 11, 10, 9, 8];

export interface DesignEditorProps {
  board: Board;
  onBoardChange: (b: Board) => void;
  issues: MapIssue[];
  highlightHexes: Hex[];
  // Where to render the tool controls: portalled into this sidebar slot when
  // provided, otherwise inline beneath the canvas (e.g. in tests).
  toolsSlot?: HTMLElement | null;
  busy?: boolean;
  onStrokeStart?: () => void;
  onStrokeEnd?: () => void;
  // Back to a blank map; shown in shape mode when provided.
  onReset?: () => void;
  // Which tool tab to open on; the shell opens a fresh builder on Shape.
  initialTool?: "shape" | "tiles" | "harbors";
  // Whether gold is on the resource palette. Gold only produces under Islands
  // (engine/module.go), so offering it otherwise would paint a tile the engine
  // refuses. Off by default; the builder opens on the base game.
  allowGold?: boolean;
  // A tool tab was clicked. The shell uses it to roll what that tab edits when
  // there is nothing yet (a board waiting for the roll, a portless coast): both
  // are server rolls against seeds the shell owns, and only it knows whether a
  // roll is in flight. Not fired for the tab already open.
  //
  // Returning false vetoes the tab, so the shell can warn before opening a
  // hand-editing tab. The tab is committed after the promise settles, so the
  // shell can await a dialog; anything but an explicit false lets it open.
  onToolChange?: (tool: "shape" | "tiles" | "harbors") => void | boolean | Promise<void | boolean>;
}

// Which palette the next click paints with, toggled by touching a palette.
// Drags use the press layer (chip vs body) for swaps; clicks use this toggle.
type Layer = "resource" | "number";

// Top-level tool mode: the outline (add or erase land), tile editing (resource
// + number), or harbor placement.
type ToolMode = "shape" | "tiles" | "harbors";
// The two outline brushes. Water is an eraser: an erased hex is absent from the
// board and the engine computes the sea around what is left.
type ShapeBrush = "land" | "water";

const PORT_RESOURCES = new Set(["wood", "brick", "sheep", "wheat", "ore"]);

// The terrain a palette button paints, in words. Descriptors rather than
// strings because module constants are evaluated once at import, which would
// freeze the language. Lower case because the buttons capitalise in CSS.
// Marked a standalone label: nothing here governs the noun.
const DESERT_WORD = msg({ message: "desert", context: "map terrain" });

const TERRAIN_WORD: Partial<Record<Resource, MessageDescriptor>> = {
  wood: msg({ message: "wood", context: "resource, standalone label" }),
  brick: msg({ message: "brick", context: "resource, standalone label" }),
  sheep: msg({ message: "sheep", context: "resource, standalone label" }),
  wheat: msg({ message: "wheat", context: "resource, standalone label" }),
  ore: msg({ message: "ore", context: "resource, standalone label" }),
  gold: msg({ message: "gold", context: "resource, standalone label" }),
  none: DESERT_WORD,
};

/**
 * The picture for one terrain on a palette button: the game's own icon for the
 * five producing resources (`icon_wood` .. `icon_ore`), as on cards, cost
 * chips and log lines. Gold, desert and sea keep a colour chip: the pack's
 * `icon_gold` is the scenario gold currency, not this hex, and a desert pays
 * nothing. A resource icon draws nothing until it loads; the chip is only for
 * the terrains with no icon at all.
 */
function TerrainSwatch({ res }: { res: Resource }) {
  const chip = (
    <span
      data-swatch-edge={res === "sea" ? "dark" : undefined}
      className="w-4 h-4 rounded-sm border border-transparent shrink-0 bg-(--swatch)"
      style={{ "--swatch": terrainFill(res) } as React.CSSProperties}
    />
  );
  const slot = resIconSlot(RES.find((x) => x.key === res)?.idx ?? 0);
  if (!slot) return chip;
  return <ResIcon slot={slot} size={16} className="shrink-0" />;
}

/** The word for one terrain. Anything unnamed reads as the bare, empty tile. */
function terrainWord(res: Resource): MessageDescriptor {
  return TERRAIN_WORD[res] ?? DESERT_WORD;
}

// The two tool modes and the two paint modes, as the tabs name them. "draw" is
// a brush stroke and "swap" two tiles changing places; each carries a context
// because "draw" means drawing a card elsewhere.
const TOOL_MODE_LABEL: Record<ToolMode, MessageDescriptor> = {
  shape: msg({ message: "shape", context: "map builder tool mode" }),
  tiles: msg({ message: "tiles", context: "map builder tool mode" }),
  harbors: msg({ message: "harbours", context: "map builder tool mode" }),
};
// Land and Water are terrain here but a resource and a hex kind elsewhere, so
// each carries the context that says it is a brush in the map builder.
const SHAPE_BRUSH_LABEL: Record<ShapeBrush, MessageDescriptor> = {
  land: msg({ message: "Land", context: "map builder brush" }),
  water: msg({ message: "Water", context: "map builder brush" }),
};

const PAINT_MODE_LABEL: Record<"draw" | "swap", MessageDescriptor> = {
  draw: msg({ message: "draw", context: "paint with a brush" }),
  swap: msg({ message: "swap", context: "exchange two tiles" }),
};

// The harbor palette: erase, the generic 3:1, then a 2:1 per resource. `key`
// identifies the entry for selection and for tests. `label` is a thunk
// evaluated at render, since a 2:1 label composes a rate and a resource into
// one message, and the component re-renders on a language change.
const HARBOR_BRUSHES: {
  key: string;
  label: () => string;
  brush: HarborBrush;
  swatch?: Resource;
  /** An icon from the icon set, for the brushes that are not a resource. */
  icon?: React.ReactNode;
}[] = [
  {
    key: "erase",
    label: () => t({ message: "erase", context: "map builder brush" }),
    brush: "erase",
    icon: <X weight="bold" size={14} />,
  },
  {
    key: "3:1",
    label: () => t({ message: "3:1 any", context: "port rate" }),
    brush: { ratio: 3, res: "none" },
    icon: <Boat weight="bold" size={14} />,
  },
  ...PRODUCING.map((r) => ({
    key: `2:1-${r}`,
    label: () => {
      const resource = i18n._(terrainWord(r));
      return t`2:1 ${resource}`;
    },
    // `as const` pins the 2: HarborBrush is a union discriminated on the ratio,
    // and a widened `number` matches neither arm.
    brush: { ratio: 2 as const, res: r },
    swatch: r,
  })),
];

const brushKey = (b: HarborBrush) =>
  b === "erase" ? "erase" : b.ratio === 3 ? "3:1" : `2:1-${b.res}`;

export function DesignEditor({
  board,
  onBoardChange,
  issues,
  highlightHexes,
  toolsSlot,
  busy,
  onStrokeStart,
  onStrokeEnd,
  onReset,
  initialTool = "tiles",
  onToolChange,
  allowGold = false,
}: DesignEditorProps) {
  // `_` renders the palette descriptors; taking it from the hook subscribes
  // this component to language changes.
  const { _ } = useLingui();
  const harboursPlaced = plural(board.harbors.length, {
    one: "# harbour placed.",
    other: "# harbours placed.",
  });
  const svgRef = React.useRef<SVGSVGElement>(null);
  const pz = usePanZoom({
    svgRef,
    panButtons: [1, 2],
    min: BUILDER_MIN_ZOOM,
    initial: BUILDER_DESIGN_ZOOM,
  }); // primary paints/drags; middle/right pan
  const [toolMode, setToolMode] = React.useState<ToolMode>(initialTool);
  const [shapeBrush, setShapeBrush] = React.useState<ShapeBrush>("land");
  // The canvas extent: opens at the smallest rectangle that holds the board
  // and grows on demand. Never shrinks below what the board needs, and a board
  // that arrives bigger (a loaded code) grows it.
  const [canvas, setCanvas] = React.useState(() => Math.max(DEFAULT_CANVAS, fitCanvas(board)));
  const fit = fitCanvas(board);
  const size = Math.max(canvas, fit);
  const cells = React.useMemo(() => rectHexes(size), [size]);
  const [layer, setLayer] = React.useState<Layer>("resource");
  const [resTool, setResTool] = React.useState<Resource>("wood");
  // The palette as offered. Gold leaves it when Islands does, and a brush
  // holding gold falls back to wood so the selection is always visible.
  const palette = React.useMemo(
    () => (allowGold ? DESIGN_RESOURCES : DESIGN_RESOURCES.filter((r) => r !== "gold")),
    [allowGold],
  );
  React.useEffect(() => {
    if (!allowGold && resTool === "gold") setResTool("wood");
  }, [allowGold, resTool]);
  const [numTool, setNumTool] = React.useState<number>(6);
  // Draw paints like the Shape brush (the default); swap exchanges two tiles.
  const [paintMode, setPaintMode] = React.useState<"draw" | "swap">("draw");
  // Harbor mode paints the selected port type onto a coast edge in one click.
  const [harborBrush, setHarborBrush] = React.useState<HarborBrush>({ ratio: 3, res: "none" });

  const hi = React.useMemo(() => new Set(highlightHexes.map(hexKey)), [highlightHexes]);
  const errHexes = React.useMemo(() => {
    const s = new Set<string>();
    for (const i of issues) if (i.severity === "error") for (const h of i.hexes) s.add(hexKey(h));
    return s;
  }, [issues]);

  // Harbor mode: coastal edges and their layout positions.
  const coastalEdges = React.useMemo(() => coastEdges(board), [board]);
  const landSet = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const t of board.tiles)
      if (t.res !== "sea" && t.res !== "border") m.set(hexKey(t.hex), true);
    return m;
  }, [board.tiles]);
  // The view box frames the whole canvas rather than the tiles, so the water
  // cells a Land brush can reach are on screen and the frame holds still while
  // tiles are added and erased.
  const vb = boardViewBox(
    cells.map((hex) => ({ hex })),
    S,
  );
  const present = React.useMemo(
    () => new Set(board.tiles.map((t) => hexKey(t.hex))),
    [board.tiles],
  );
  const center = React.useMemo(
    () => ({ x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 }),
    [vb.x, vb.y, vb.w, vb.h],
  );
  const harborLayerLayouts = React.useMemo(
    () => harborLayouts(board.harbors, (h) => landSet.has(hexKey(h)), center, S),
    [board.harbors, landSet, center],
  );

  // Draw-mode brush state: whether a stroke is in progress, the last hex key
  // painted (to skip re-painting the same tile twice in one stroke), and an
  // accumulator buffer so fast sweeps never lose earlier tiles in the stroke.
  const painting = React.useRef(false);
  const lastPaintKey = React.useRef<string | null>(null);
  const paintBuf = React.useRef<BoardTile[]>(board.tiles);

  // In-flight drag: the origin hex, which layer is being dragged, and whether
  // the pointer has yet left that origin hex. A ref (not state) so the pointer
  // handlers stay synchronous and never trigger a re-render mid-gesture.
  const drag = React.useRef<{
    from: Hex;
    layer: DragLayer;
    moved: boolean;
    lastOverQ?: number | null;
    lastOverR?: number | null;
  } | null>(null);
  // Visible drag feedback in state, so the canvas can ring the grabbed tile
  // and the target and show a ghost of the dragged number or resource. Updated
  // only when the hovered hex changes.
  const [dragVis, setDragVis] = React.useState<{
    from: Hex;
    layer: DragLayer;
    over: Hex | null;
    moved: boolean;
  } | null>(null);
  const dragFromTile = dragVis
    ? board.tiles.find((t) => t.hex.q === dragVis.from.q && t.hex.r === dragVis.from.r)
    : undefined;

  // Hit-test with elementFromPoint (as ShapeEditor does), which is in pointer
  // space and so matches hover under the CSS `zoom`. The center chip carries
  // data-chip ("number"), the tile body data-hex ("resource"); data-chip wins,
  // so grabbing the chip drags the number.
  function targetAt(e: React.PointerEvent): { hex: Hex; layer: DragLayer } | null {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const chip = el?.closest?.("[data-chip]")?.getAttribute("data-chip");
    if (chip) {
      const [q, r] = chip.split(",").map(Number);
      return { hex: { q, r }, layer: "number" };
    }
    const hex = el?.closest?.("[data-hex]")?.getAttribute("data-hex");
    if (hex) {
      const [q, r] = hex.split(",").map(Number);
      return { hex: { q, r }, layer: "resource" };
    }
    return null;
  }

  // Paint one tile in draw mode by the active palette layer, accumulating into the
  // brush buffer so consecutive paints in a single sweep never lose earlier tiles.
  function paintAt(hex: Hex) {
    const k = hexKey(hex);
    if (k === lastPaintKey.current) return; // already painted this tile this stroke
    lastPaintKey.current = k;
    paintBuf.current =
      layer === "resource"
        ? setTileResource(paintBuf.current, hex, resTool)
        : setTileNumber(paintBuf.current, hex, numTool);
    // A resource painted over authored sea turns that hex into land, which can
    // leave a harbor on its edge facing inland. Same rule as the shape brush.
    onBoardChange({
      ...board,
      tiles: paintBuf.current,
      harbors: pruneInlandHarbors(board, paintBuf.current),
    });
  }

  // The outline brush accumulates whole boards rather than tile lists, because
  // erasing a hex can move the robber and drop ports as well as the tile.
  const shapeBuf = React.useRef<Board>(board);
  function shapeAt(hex: Hex) {
    const k = hexKey(hex);
    if (k === lastPaintKey.current) return;
    lastPaintKey.current = k;
    shapeBuf.current =
      shapeBrush === "land" ? addLand(shapeBuf.current, hex) : removeLand(shapeBuf.current, hex);
    onBoardChange(shapeBuf.current);
  }

  function onPointerDown(e: React.PointerEvent) {
    pz.bind.onPointerDown(e); // middle/right button → pan
    if (busy) return;
    if (toolMode === "harbors") return; // edge clicks handled via onClick on the SVG lines
    if (e.button !== 0) return; // only the primary button paints/drags
    const t = targetAt(e);
    if (!t) return;
    if (toolMode === "shape") {
      onStrokeStart?.();
      painting.current = true;
      lastPaintKey.current = null;
      shapeBuf.current = board;
      shapeAt(t.hex);
      svgRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }
    // Tiles mode paints only hexes that hold a tile; the water cells are the
    // outline brush's business.
    if (!present.has(hexKey(t.hex))) return;
    if (paintMode === "draw") {
      onStrokeStart?.();
      painting.current = true;
      lastPaintKey.current = null;
      paintBuf.current = board.tiles;
      paintAt(t.hex);
      svgRef.current?.setPointerCapture?.(e.pointerId);
      return;
    }
    drag.current = { from: t.hex, layer: t.layer, moved: false };
    setDragVis({ from: t.hex, layer: t.layer, over: t.hex, moved: false });
    svgRef.current?.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    pz.bind.onPointerMove(e);
    if (toolMode === "harbors") return;
    if (toolMode === "shape") {
      if (!painting.current) return;
      const t = targetAt(e);
      if (t) shapeAt(t.hex);
      return;
    }
    if (paintMode === "draw") {
      if (!painting.current) return;
      const t = targetAt(e);
      if (t && present.has(hexKey(t.hex))) paintAt(t.hex);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const t = targetAt(e);
    const overChanged =
      (t?.hex.q ?? null) !== (d.lastOverQ ?? null) || (t?.hex.r ?? null) !== (d.lastOverR ?? null);
    if (t && (t.hex.q !== d.from.q || t.hex.r !== d.from.r)) d.moved = true;
    if (overChanged) {
      d.lastOverQ = t?.hex.q ?? null;
      d.lastOverR = t?.hex.r ?? null;
      setDragVis({ from: d.from, layer: d.layer, over: t?.hex ?? null, moved: d.moved });
    }
  }

  function endPaint() {
    if (painting.current) onStrokeEnd?.();
    painting.current = false;
    lastPaintKey.current = null;
  }

  function onPointerUp(e: React.PointerEvent) {
    pz.bind.onPointerUp(e);
    if (toolMode === "shape" || paintMode === "draw") {
      endPaint();
      return;
    }
    setDragVis(null);
    if (toolMode === "harbors") return;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const t = targetAt(e);
    onBoardChange({
      ...board,
      tiles: applyDrag({
        tiles: board.tiles,
        from: d.from,
        to: t?.hex ?? null,
        layer: d.layer,
        paintLayer: layer,
        moved: d.moved,
        paintRes: resTool,
        paintNum: numTool,
      }),
    });
  }

  function onHarborEdgeClick(e: Edge) {
    if (busy) return;
    // The blocked edges are inert, but a keyboard or programmatic click still
    // must not stack two docks on one hex.
    if (!canPlaceHarbor(board, e)) return;
    onBoardChange({ ...board, harbors: setHarbor(board.harbors, e, harborBrush) });
  }

  // Move to a tab, giving the shell its veto first. The tab is committed once
  // `onToolChange` settles, so while a dialog is open the tabs still show where
  // the viewer is.
  async function chooseTool(m: ToolMode) {
    if (m === toolMode) return;
    if ((await onToolChange?.(m)) === false) return;
    setToolMode(m);
  }

  const tools = (
    <div className="flex flex-col gap-3">
      <div className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-2">
        {/* tool mode tabs */}
        <div className="flex gap-1.5">
          {(["shape", "tiles", "harbors"] as ToolMode[]).map((m) => (
            <button
              key={m}
              data-tooltab={m}
              onClick={() => void chooseTool(m)}
              className={`flex-1 border rounded-base px-3 py-1 text-[12px] font-semibold capitalize ${toolMode === m ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"}`}
            >
              {_(TOOL_MODE_LABEL[m])}
            </button>
          ))}
        </div>

        {/* outline: canvas size, the two brushes, and a way back to a blank map */}
        {toolMode === "shape" && (
          <>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[12px] font-semibold text-muted">
                <Trans context="map builder panel heading">Canvas</Trans>
              </span>
              <span className="text-[12px] font-semibold">{size}</span>
            </div>
            <Slider
              min={MIN_CANVAS}
              max={MAX_CANVAS}
              step={1}
              value={[size]}
              onValueChange={([v]) => setCanvas(Math.max(v, fit))}
            />
            <div className="text-[12px] font-semibold text-muted mt-1">
              <Trans context="map builder panel heading">Brush</Trans>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["land", "water"] as ShapeBrush[]).map((b) => (
                <button
                  key={b}
                  data-shapebrush={b}
                  onClick={() => setShapeBrush(b)}
                  className={`flex items-center gap-1.5 border rounded-base px-2 py-1.5 text-[12px] font-semibold ${shapeBrush === b ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"}`}
                >
                  <span
                    // The sea chip sank into the navy well in dark mode: it
                    // takes the dark-theme keyline (pb-site.css).
                    data-swatch-edge={b === "water" ? "dark" : undefined}
                    className="w-4 h-4 rounded-sm border border-transparent shrink-0 bg-(--swatch)"
                    style={
                      {
                        "--swatch": b === "land" ? terrainFill("land") : terrainFill("sea"),
                      } as React.CSSProperties
                    }
                  />
                  {_(SHAPE_BRUSH_LABEL[b])}
                </button>
              ))}
            </div>
            {onReset && (
              // Destructive: a red piece.
              <Button
                tone="danger"
                size="field"
                pill={false}
                data-shapeaction="reset"
                onClick={onReset}
                className="mt-1"
              >
                <Trans context="map builder, clear the canvas">Reset to a blank map</Trans>
              </Button>
            )}
            <div className="text-[13px] text-muted leading-[1.45] mt-1">
              <Trans>
                Paint <b>Land</b> to add tiles and <b>Water</b> to erase them. Blank land is filled
                by Generate; water that splits the land into separate islands makes it an{" "}
                <b>Islands</b> map.
              </Trans>
            </div>
          </>
        )}

        {/* tile palettes, only shown in tiles mode */}
        {toolMode === "tiles" && (
          <>
            {/* paint-mode toggle: Draw (brush) vs Swap (drag one tile onto another) */}
            <div className="flex gap-1.5">
              {(["draw", "swap"] as const).map((pm) => (
                <button
                  key={pm}
                  data-paintmode={pm}
                  onClick={() => setPaintMode(pm)}
                  className={`flex-1 border rounded-base px-3 py-1 text-[12px] font-semibold capitalize ${paintMode === pm ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"}`}
                >
                  {_(PAINT_MODE_LABEL[pm])}
                </button>
              ))}
            </div>

            {/* resource palette */}
            <div className="text-[12px] font-semibold text-muted">
              <Trans context="map builder panel heading">Resource</Trans>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {palette.map((r) => (
                <button
                  key={r}
                  data-restool={r}
                  onClick={() => {
                    setLayer("resource");
                    setResTool(r);
                  }}
                  className={`flex items-center gap-1.5 border rounded-base px-2 py-1.5 text-[12px] font-semibold capitalize ${layer === "resource" && resTool === r ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"}`}
                >
                  <TerrainSwatch res={r} />
                  {_(terrainWord(r))}
                </button>
              ))}
            </div>

            {/* number palette */}
            <div className="text-[12px] font-semibold text-muted mt-1">
              <Trans context="map builder panel heading">Number</Trans>
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {NUMBERS.map((n) => (
                <button
                  key={n}
                  data-numtool={n}
                  onClick={() => {
                    setLayer("number");
                    setNumTool(n);
                  }}
                  className={`border rounded-base px-2.5 py-1 text-[13px] font-semibold ${layer === "number" && numTool === n ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"} ${n === 6 || n === 8 ? "text-red-ink" : ""}`}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="text-[13px] text-muted leading-[1.45] mt-1">
              {paintMode === "draw" ? (
                <Trans>
                  Click or drag to <b>paint</b> the selected resource or number across tiles.
                </Trans>
              ) : (
                <Trans>
                  Click a tile to paint the selected resource or number. <b>Drag</b> a tile to swap
                  with another. Grab the number chip to move numbers, the tile body to move
                  resources.
                </Trans>
              )}
            </div>
          </>
        )}

        {/* harbor palette, shown in harbors mode */}
        {toolMode === "harbors" && (
          <>
            <div className="text-[12px] font-semibold text-muted">
              <Trans context="map builder panel heading">Harbour</Trans>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {HARBOR_BRUSHES.map((b) => (
                <button
                  key={b.key}
                  data-harbortool={b.key}
                  onClick={() => setHarborBrush(b.brush)}
                  className={`flex items-center gap-1.5 border rounded-base px-2 py-1.5 text-[12px] font-semibold capitalize ${brushKey(harborBrush) === b.key ? "border-transparent bg-selected text-selected-ink" : "border-line hover:bg-elev"}`}
                >
                  {b.swatch ? (
                    <TerrainSwatch res={b.swatch} />
                  ) : (
                    <span aria-hidden className="w-4 h-4 shrink-0 grid place-items-center">
                      {b.icon}
                    </span>
                  )}
                  {b.label()}
                </button>
              ))}
            </div>

            <div className="flex gap-1.5 mt-1">
              {/* Destructive: a red piece (grey and pushed down when there is
                  nothing to clear). */}
              <Button
                tone="danger"
                size="field"
                pill={false}
                data-harboraction="clear"
                onClick={() => onBoardChange({ ...board, harbors: [] })}
                disabled={busy || board.harbors.length === 0}
                className="flex-1"
              >
                <Trans>Clear harbours</Trans>
              </Button>
            </div>

            <div className="text-[13px] text-muted leading-[1.45] mt-1">
              <Trans>
                Click a coastal edge to place the selected harbour; click it again to remove it.
                Greyed edges already have a dock on their water hex. {harboursPlaced}
              </Trans>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* canvas surface; the shell draws the card and header around it */}
      {/* `data-pb-mapcanvas`: pb-site.css sizes the zoom buttons up and
          draws them as pieces. */}
      <div
        data-pb-mapcanvas=""
        className="relative bg-ocean rounded-base overflow-hidden flex items-center justify-center h-[54vh] min-h-90 max-sm:h-[46svh] max-sm:min-h-65 squat:h-[calc(100svh-5.5rem)] squat:min-h-50"
      >
        <svg
          ref={svgRef}
          viewBox={vb.str}
          className={`block w-full h-full select-none touch-none ${dragVis && toolMode === "tiles" ? "cursor-grabbing" : ""}`}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (toolMode === "shape" || paintMode === "draw") endPaint();
          }}
          onPointerCancel={() => {
            if (toolMode === "shape" || paintMode === "draw") endPaint();
          }}
        >
          <g transform={pz.transform}>
            {/* The water cells: a faint outline over the ocean so the whole
                canvas is visible and, in shape mode, paintable. */}
            {cells.map((hex) =>
              present.has(hexKey(hex)) ? null : (
                <polygon
                  key={`w${hex.q},${hex.r}`}
                  data-hex={`${hex.q},${hex.r}`}
                  data-water
                  points={hexPolygon(hex, S)}
                  strokeWidth={1.5}
                  className={cn(
                    "fill-main-foreground/5 stroke-main-foreground/18",
                    toolMode === "shape" && "cursor-pointer hover:brightness-110",
                  )}
                />
              ),
            )}
            {board.tiles.map((t, i) => {
              const k = hexKey(t.hex);
              const fill = t.res === "land" ? previewFill(t.res, t.hex) : terrainFill(t.res);
              const c = hexCenter(t.hex, S);
              // Strokes use only existing theme tokens: red flags an error tile,
              // an accent (blue) flashes a clicked-warning highlight, ink otherwise.
              const stroke = errHexes.has(k)
                ? "var(--color-red)"
                : hi.has(k)
                  ? "var(--color-blue)"
                  : "var(--color-ink)";
              const sw = errHexes.has(k) || hi.has(k) ? 4 : 2.5;
              return (
                <g key={i}>
                  <polygon
                    data-hex={`${t.hex.q},${t.hex.r}`}
                    points={hexPolygon(t.hex, S)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={sw}
                    className={toolMode !== "harbors" ? "cursor-pointer hover:brightness-95" : ""}
                  />
                  {canHoldNumber(t.res) && t.num > 0 && (
                    // The chip group carries data-chip so a pointer on it drags
                    // the number layer. The chip art stays hittable so
                    // closest('[data-chip]') resolves the hex; only the inner
                    // text is non-interactive.
                    <g
                      data-chip={`${t.hex.q},${t.hex.r}`}
                      className={toolMode === "tiles" ? "cursor-pointer" : ""}
                    >
                      <TokenChipArt cx={c.x} cy={c.y} />
                      <g pointerEvents="none">
                        <TokenLabel cx={c.x} cy={c.y} num={t.num} />
                      </g>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Harbor mode: existing port labels, seaward of their coast edges */}
            {board.harbors.map((h, i) => {
              const layout = harborLayerLayouts[i];
              if (!layout) return null;
              const { pts, out } = layout;
              const info = portInfo(h.res);
              const hasIcon = PORT_RESOURCES.has(h.res);
              return (
                <g key={`h${i}`}>
                  {pts.map((p, j) => (
                    <line
                      key={j}
                      x1={p.x}
                      y1={p.y}
                      x2={out.x}
                      y2={out.y}
                      stroke="var(--color-ink)"
                      strokeWidth={1.25}
                      strokeLinecap="round"
                    />
                  ))}
                  <g transform={`translate(${out.x},${out.y})`} className="pointer-events-none">
                    <rect
                      x={-23}
                      y={-15}
                      width={46}
                      height={30}
                      rx={8}
                      fill="var(--color-main-foreground)"
                      stroke="var(--color-ink)"
                      strokeWidth={1.5}
                    />
                    {hasIcon ? (
                      <>
                        <image
                          href={
                            assetURL(resIconSlot(RES.find((r) => r.key === h.res)?.idx ?? 0)) ??
                            undefined
                          }
                          x={-20}
                          y={-10}
                          width={20}
                          height={20}
                        />
                        <text
                          x={8}
                          y={4}
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={800}
                          fill="var(--color-ink)"
                        >
                          {h.ratio}:1
                        </text>
                      </>
                    ) : (
                      <>
                        <text
                          x={0}
                          y={-1}
                          textAnchor="middle"
                          fontSize={12}
                          fontWeight={800}
                          fill="var(--color-ink)"
                        >
                          {h.ratio}:1
                        </text>
                        <text
                          x={0}
                          y={9}
                          textAnchor="middle"
                          fontSize={6.5}
                          fontWeight={800}
                          fill="var(--color-ink)"
                          letterSpacing="0.3"
                        >
                          {info.label}
                        </text>
                      </>
                    )}
                  </g>
                </g>
              );
            })}

            {/* Harbor mode: clickable coastal edges overlay */}
            {toolMode === "harbors" &&
              coastalEdges.map((e, i) => {
                const [a, b] = edgeEnds(e, S);
                const m = edgeMid(e, S);
                // A harbour's dock stands on the water hex beside its edge, so
                // an edge whose water hex is taken cannot host another. Such
                // edges are drawn muted and inert rather than hidden.
                const open = canPlaceHarbor(board, e);
                return (
                  <g
                    key={`ce${i}`}
                    data-coastedge={edgeKey(e)}
                    data-harborable={open}
                    className={open ? "cursor-pointer" : "cursor-not-allowed"}
                    onClick={open ? () => onHarborEdgeClick(e) : undefined}
                  >
                    {/* wide transparent hit area */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={14}
                    />
                    {/* visible coastal edge highlight */}
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={open ? "var(--color-blue)" : "var(--color-muted)"}
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeOpacity={open ? 0.7 : 0.25}
                    />
                    {/* small dot at midpoint for discoverability */}
                    {open && (
                      <circle
                        cx={m.x}
                        cy={m.y}
                        r={5}
                        fill="var(--color-blue)"
                        fillOpacity={0.5}
                        stroke="var(--color-ink)"
                        strokeWidth={1}
                      />
                    )}
                  </g>
                );
              })}

            {/* Drag feedback: ring the tile you grabbed; once the pointer moves
                to another tile, ring that target and show a ghost of what will
                land there. Numbers ring the round chip; resources ring the hex
                and show a swatch of the resource. */}
            {dragVis &&
              (() => {
                const fromC = hexCenter(dragVis.from, S);
                const overC = dragVis.over ? hexCenter(dragVis.over, S) : null;
                const onNewTile =
                  dragVis.moved &&
                  dragVis.over &&
                  (dragVis.over.q !== dragVis.from.q || dragVis.over.r !== dragVis.from.r);
                const isNumber = dragVis.layer === "number";
                const ringR = S * 0.44; // just outside the number chip (chip r = S*0.34)
                return (
                  <g pointerEvents="none">
                    {/* source: you grabbed this */}
                    {isNumber ? (
                      <circle
                        cx={fromC.x}
                        cy={fromC.y}
                        r={ringR}
                        fill="none"
                        stroke="var(--color-blue)"
                        strokeWidth={3.5}
                        strokeDasharray="6 4"
                      />
                    ) : (
                      <polygon
                        points={hexPolygon(dragVis.from, S)}
                        className="fill-blue/10"
                        stroke="var(--color-blue)"
                        strokeWidth={4}
                        strokeDasharray="7 5"
                        strokeLinejoin="round"
                      />
                    )}
                    {/* target: drop here */}
                    {onNewTile &&
                      overC &&
                      (isNumber ? (
                        <>
                          <circle
                            cx={overC.x}
                            cy={overC.y}
                            r={ringR}
                            fill="none"
                            stroke="var(--color-blue)"
                            strokeWidth={4.5}
                          />
                          {dragFromTile && dragFromTile.num > 0 && (
                            <g opacity={0.9}>
                              <TokenChipArt cx={overC.x} cy={overC.y} />
                              <TokenLabel cx={overC.x} cy={overC.y} num={dragFromTile.num} />
                            </g>
                          )}
                        </>
                      ) : (
                        <>
                          <polygon
                            points={hexPolygon(dragVis.over!, S)}
                            className="fill-blue/16"
                            stroke="var(--color-blue)"
                            strokeWidth={5}
                            strokeLinejoin="round"
                          />
                          {dragFromTile &&
                            (PORT_RESOURCES.has(dragFromTile.res) ? (
                              <image
                                href={
                                  assetURL(
                                    resIconSlot(
                                      RES.find((r) => r.key === dragFromTile.res)?.idx ?? 0,
                                    ),
                                  ) ?? undefined
                                }
                                x={overC.x - S * 0.42}
                                y={overC.y - S * 0.42}
                                width={S * 0.84}
                                height={S * 0.84}
                                opacity={0.85}
                              />
                            ) : (
                              <circle
                                cx={overC.x}
                                cy={overC.y}
                                r={S * 0.42}
                                fill={
                                  dragFromTile.res === "land"
                                    ? previewFill(dragFromTile.res, dragVis.from)
                                    : terrainFill(dragFromTile.res)
                                }
                                opacity={0.85}
                                stroke="var(--color-ink)"
                                strokeWidth={2}
                              />
                            ))}
                        </>
                      ))}
                  </g>
                );
              })()}
          </g>
        </svg>
        <ZoomControls
          className="bottom-3 right-3 gap-2"
          onZoomIn={pz.zoomIn}
          onZoomOut={pz.zoomOut}
          onReset={pz.reset}
        />
      </div>

      {/* Tool controls: into the sidebar slot when provided, else inline. */}
      {/* Inline, the tool panel keeps a gap from the canvas rather than
          fusing to its foot. */}
      {toolsSlot === undefined ? (
        <div className="mt-3">{tools}</div>
      ) : toolsSlot ? (
        createPortal(tools, toolsSlot)
      ) : null}
    </>
  );
}
