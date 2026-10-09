import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { SiteHeader } from "@/components/SiteHeader";
import { Screen } from "@/components/Screen";
import { PageBody } from "@/components/PageBody";
import { PageTitle } from "@/components/PageTitle";
import { CaretDown, Cube, Path } from "@/lib/icons";
import { inActivityMode } from "@/lib/activity";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExpansionShelf } from "@/components/lobby/ExpansionShelf";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/errorCopy";
import { useAuth } from "@/lib/auth";
import { useAbandonGuard } from "@/components/AbandonGuard";
import { useConfirm } from "@/components/ui/confirm";
import {
  assembleRuleset,
  parseExpansions,
  defaultConfig,
  recommendedPlayers,
  retargetVP,
  mapNeedsShips,
  groupedExpansions,
  type Expansions,
} from "@/lib/format";
import { takeBuilderBoard, takeBuilderSource, type BuilderSource } from "@/lib/maps/handoff";
import { frameForExport } from "@/lib/maps/framed-gallery";
import { GALLERY } from "@/lib/maps/gallery";

/**
 * The map switching Islands on installs: Shores (Small), the gallery's 3-4
 * player islands map, which is the islands board a table of four is dealt.
 */
const ISLANDS_DEFAULT_MAP = "shores";
import { blankBoard, centerDesert, hasBlanks, stripToShape } from "@/lib/maps/board";
import { useLint } from "@/lib/maps/useLint";
import { randomSeed } from "@/lib/preview/seed";
import { useBoardHistory } from "./mapbuilder/useBoardHistory";
import { DesignEditor } from "./mapbuilder/DesignEditor";
import { WarningsPanel } from "./mapbuilder/WarningsPanel";
import { GeneratePanel, type RollMode, type SeedControlsProps } from "./mapbuilder/GeneratePanel";
import { PreviewOverlay } from "./mapbuilder/PreviewOverlay";
import { useBoardPreview } from "./mapbuilder/useBoardPreview";
import type { Board, Hex, MapRow } from "@/lib/types";
import { Trans, useLingui } from "@lingui/react/macro";
import { plural } from "@lingui/core/macro";
import { formatList, formatNumber } from "@/lib/intl";
import { cn } from "@/lib/utils";

/**
 * Expansions the builder offers: the ones that change the map. Islands carves
 * sea and gold, Fishermen floods the desert into a lake, Caravans wants an
 * oasis, Rivers lays a river, Raiders shapes the coast, Wagons places its
 * trade hexes. Knights and Harbormaster change no tiles, so they are picked in
 * the lobby, and a set that arrives from a lobby keeps them through Apply.
 * Explorers deals its own map and refuses an authored one.
 */
const BUILDER_EXPANSIONS: ReadonlySet<keyof Expansions> = new Set<keyof Expansions>([
  "islands",
  "fishermen",
  "caravans",
  "rivers",
  "raiders",
  "wagons",
]);

/** How many seats the preview draws and Play opens: the top of the recommended range, clamped. */
const seatsFor = (rec: { min: number; max: number }) => Math.min(10, Math.max(3, rec.max));

export function MapBuilder() {
  const { t, i18n } = useLingui();
  const { me } = useAuth();
  const navigate = useNavigate();
  const guard = useAbandonGuard();
  const confirm = useConfirm();
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [importText, setImportText] = React.useState("");
  // When the builder was opened from a lobby the user hosts, "Play this map"
  // becomes "Apply to lobby": patch that lobby's map in place and return to it,
  // rather than abandoning it for a brand-new game. Null for standalone visits.
  const [source, setSource] = React.useState<BuilderSource | null>(null);
  // Copy feedback lives next to the button rather than in the shared `notice`,
  // which renders in the card above and would shift this card on every click.
  const [copyMsg, setCopyMsg] = React.useState<string | null>(null);
  const copyTimer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // The board. Tiles are blank land until the roll (or a brush) gives them a
  // resource and a number, and the engine fills whatever is still blank at the
  // table. A fresh builder opens on a blank hexagon the size of the standard
  // map.
  const history = useBoardHistory(() => blankBoard(2));
  const { board, setBoard, undo, redo, canUndo, canRedo, inStroke } = history;

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        busy ||
        inStroke ||
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable], [role=dialog]")
      )
        return;
      const key = event.key.toLowerCase();
      if (key === "z" || (key === "y" && !event.shiftKey)) {
        event.preventDefault();
        if (event.shiftKey || key === "y") redo();
        else undo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, inStroke, undo, redo]);
  // Whether the fullscreen 3D preview is up.
  const [previewOpen, setPreviewOpen] = React.useState(false);
  // Tiles to flash on the canvas when hovering an issue in the warnings panel.
  const [highlight, setHighlight] = React.useState<Hex[]>([]);
  // The active editor portals its tool controls into this sidebar slot, so the
  // main column holds only the canvas and the controls sit on the right.
  const [toolsSlot, setToolsSlot] = React.useState<HTMLDivElement | null>(null);

  // The roll. Two seeds: the tile seed (resources, numbers, deserts, and what
  // the preview deals the expansion layers from) and the port seed, which
  // follows the tile seed while empty. `rolled*` are the seeds that dealt the
  // board on screen, so the panel can tell a changed field from a settled one.
  const [seed, setSeed] = React.useState("");
  const [portSeed, setPortSeed] = React.useState("");
  const [centerDesertOn, setCenterDesertOn] = React.useState(false);
  const [rollMode, setRollMode] = React.useState<RollMode>("fair");

  // The expansions the table will play, chosen here so the preview shows their
  // layers and Play opens a lobby with them on. Islands is the one that also
  // changes the board (see `switchIslands`).
  const [exp, setExp] = React.useState<Expansions>(() => parseExpansions("base"));
  const [expOpen, setExpOpen] = React.useState(true);

  const built = board;
  // A board the roll has not finished: blank land, or a producing tile with no
  // number. Playable (the engine rolls the rest at the table), but not what the
  // preview shows until it has been generated.
  const blanks = hasBlanks(built);

  // Islands is a choice that installs a map. The switch is always live, and
  // toggling it resets the board to that mode's default: on installs the 3-4
  // player islands map, off returns the blank hexagon. See `switchIslands`.
  //
  // The geometry still forces it on: a loaded code whose land is in pieces, or
  // which carries gold, is an islands map whatever the switch says. It never
  // forces it off.
  const hasGold = built.tiles.some((x) => x.res === "gold");
  const splitLand = mapNeedsShips(built);
  const needsIslands = splitLand || hasGold;
  const islandsOn = needsIslands || exp.islands;
  const ruleset = assembleRuleset({ ...exp, islands: islandsOn });

  const landCount = built.tiles.filter((t) => t.res !== "sea" && t.res !== "border").length;
  const tileCount = plural(landCount, { one: "# tile", other: "# tiles" });
  // Server lint, given the ruleset Play will use, so terrain/ruleset
  // eligibility (gold needs Islands, Islands needs water) shows as a blocking
  // lint error rather than an opaque error at Play time. Only lint errors
  // block.
  const issues = useLint(built, landCount >= 3, ruleset);
  const hasError = issues.some((i) => i.severity === "error");
  const valid = landCount >= 3 && !hasError;
  const rec = recommendedPlayers(built);
  const seats = seatsFor(rec);

  // The dealt board for the preview: the board through the real setup path
  // under the chosen ruleset and seed, module layers included. Fetched only
  // while the preview is up and nothing is left to roll.
  const preview = useBoardPreview(built, ruleset, seed, seats, previewOpen && !blanks);

  const savedMaps = useQuery({
    queryKey: ["maps", "mine"],
    queryFn: api.listMyMaps,
    enabled: !!me,
  });

  const myMaps = React.useMemo(
    () => (savedMaps.data?.maps ?? []).filter((m) => m.created_by === me?.id),
    [savedMaps.data, me?.id],
  );

  // A loaded board (a share code, a saved map, the lobby's handoff) is the
  // board, whatever state its tiles are in: a bare shape has blank land the
  // roll fills, a designed one is pinned all the way down.
  function receiveBoard(b: Board) {
    setBoard(b);
  }

  // Opened from a lobby's "Map builder →"? Load the map selected there and
  // remember the lobby so "Apply to lobby" can patch it in place.
  //
  // The handoff is one-shot (sessionStorage is read then cleared). The ref
  // guards against StrictMode's double-invoked mount effect, whose second read
  // would return null and drop a host onto the create-new path, orphaning their
  // table.
  const handoffConsumed = React.useRef(false);
  React.useEffect(() => {
    if (handoffConsumed.current) return;
    handoffConsumed.current = true;
    const src = takeBuilderSource();
    setSource(src);
    // The lobby's expansions come along, so the preview shows the table the
    // host is actually setting up and Apply hands back the same set.
    if (src) setExp(parseExpansions(src.cfg.ruleset));
    const b = takeBuilderBoard();
    if (b) {
      history.reset(b);
      setNotice(
        src
          ? t`Loaded the lobby's current map. Tweak it, then apply it back.`
          : t`Loaded the lobby's current map. Tweak it, then save or play.`,
      );
    }
    // Mount-only (see `handoffConsumed`): the handoff is taken once. `t` is
    // omitted for the same reason, so a language switch cannot re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The roll: resources, numbers, deserts and ports onto the outline, a fresh
  // map on the same shape.
  //
  // The board goes through `stripToShape` first. The endpoint pins deserts so
  // a hand-painted one survives a re-roll, but on a rolled board every desert
  // came from the previous roll, so sending it whole would only reshuffle around
  // the same holes. The "desert in the middle" switch pins one on the centre
  // tile.
  //
  // Seeds are set before the request, so the fields show the seeds that dealt
  // the board during the roll, and the server's echo is written back in case it
  // normalised them. Returns whether a board landed.
  async function generate(opts: { seed?: string; portSeed?: string } = {}): Promise<boolean> {
    if (landCount < 3) return false;
    const shape = stripToShape(built);
    const s = opts.seed ?? (seed || randomSeed());
    const ps = opts.portSeed ?? portSeed;
    setSeed(s);
    setPortSeed(ps);
    setBusy(true);
    setNotice(null);
    try {
      const { board: rolled, seed: used } = await api.randomizeMap(
        centerDesertOn ? centerDesert(shape) : shape,
        {
          mode: rollMode,
          seed: s,
          portSeed: ps,
        },
      );
      if (used) setSeed(used);
      setBoard(rolled);
      return true;
    } catch (e) {
      setNotice(apiErrorText(e, blanks ? t`Couldn't generate` : t`Couldn't regenerate`));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Arriving in a tab rolls what that tab edits, once, if it is still empty:
  // Tiles on blank land and Harbors on a portless coast otherwise have nothing
  // to work with. Each uses its own seed so they are independently
  // reproducible.
  //
  // Only while there is nothing there (`blanks`, an empty harbour list), so a
  // tab switch never loses work; re-rolling on purpose is what the dice and
  // Randomize are for. A tile roll lays ports too (`randomizeMap` returns both),
  // so the Harbors tab then finds ports already present.
  function rollForTool(tool: "shape" | "tiles" | "harbors") {
    if (busy || !valid) return;
    if (tool === "tiles" && blanks) void generate({ seed: randomSeed(), portSeed: "" });
    else if (tool === "harbors" && built.harbors.length === 0) void rerollHarbors(randomSeed());
  }

  // Hand editing is the exception. Generate balances resources, numbers and
  // ports against the shape; a board painted by hand loses that. Most maps that
  // feel wrong need a shape change, not a number dragged onto a hex.
  //
  // So Tiles and Harbors each warn once on the way in, with an option to stop
  // asking (lib/dismissed.ts; one key covers both). Advisory, never blocking.
  // Returning false vetoes the tab (see DesignEditor's onToolChange), leaving
  // the viewer where they were.
  async function enterTool(tool: "shape" | "tiles" | "harbors"): Promise<boolean> {
    if (tool !== "shape" && !(await confirm(handEditWarning(tool)))) return false;
    rollForTool(tool);
    return true;
  }

  // The copy, per tab. Both say the same thing: the shape is the lever.
  function handEditWarning(tool: "tiles" | "harbors") {
    return {
      suppressKey: "builder-hand-edit",
      confirmText:
        tool === "tiles"
          ? t({ message: "Edit tiles", context: "confirm entering the map builder's tiles tab" })
          : t({
              message: "Edit harbours",
              context: "confirm entering the map builder's harbors tab",
            }),
      cancelText: t({ message: "Keep shaping", context: "decline hand editing a built map" }),
      title: tool === "tiles" ? t`Edit tiles by hand?` : t`Edit harbours by hand?`,
      body:
        tool === "tiles" ? (
          <Trans>
            Generate already deals resources and numbers balanced against your shape. Painting over
            them keeps none of that, and a board that feels wrong is usually the wrong shape. Try
            adding or removing land and generating again first.
          </Trans>
        ) : (
          <Trans>
            Generate already lays harbours around the coast you drew. Moving them by hand keeps none
            of that balance, and a coast that feels wrong is usually the wrong shape. Try reshaping
            the coastline and generating again first.
          </Trans>
        ),
    };
  }

  // Open the fullscreen preview. A board with tiles still waiting for the roll
  // is rolled first, so the preview matches what Play sends; otherwise the
  // engine would roll it again at the table with its own seed.
  async function openPreview() {
    if (!valid) return;
    if (blanks && !(await generate())) return;
    setPreviewOpen(true);
  }

  // The default board for each mode: base opens on the blank hexagon, Islands
  // on Shores (Small). Gallery islands boards are land-only (see
  // lib/maps/gallery.ts), which is the builder's own representation of water,
  // so they need no framing.
  function defaultBoardFor(islands: boolean): Board {
    if (!islands) return blankBoard(2);
    const m = GALLERY.find((g) => g.id === ISLANDS_DEFAULT_MAP);
    // Fall back to a blank board rather than throwing: a missing gallery id is
    // a build-time mistake, and a builder that won't render is worse.
    return m ? structuredClone(m.board) : blankBoard(2);
  }

  // Whatever was installed last, so "has this person done any work" is a
  // comparison. A rolled board, a painted tile and a moved port all differ;
  // tabbing and previewing do not.
  const pristine = React.useRef<string>(JSON.stringify(blankBoard(2)));

  function installDefault(islands: boolean) {
    const b = defaultBoardFor(islands);
    pristine.current = JSON.stringify(b);
    setBoard(b);
    setNotice(null);
  }

  // Toggling Islands resets to that mode's default, so the two never disagree
  // (a base map cannot keep gold, an islands map is not a solid hexagon).
  // Confirmed first, but only when there is work to lose.
  async function switchIslands(on: boolean) {
    if (busy) return;
    if (JSON.stringify(built) !== pristine.current) {
      const ok = await confirm({
        title: on ? t`Switch to an islands map?` : t`Switch back to a base map?`,
        body: t`This replaces the board you have now.`,
        confirmText: t({
          message: "Replace",
          context: "confirm replacing the map builder's board",
        }),
        tone: "danger",
      });
      if (!ok) return;
    }
    setExp((e) => ({ ...e, islands: on }));
    installDefault(on);
  }

  // Back to a blank map: confirmed, since it throws the whole board away.
  async function resetBoard() {
    const ok = await confirm({
      title: t`Start over?`,
      body: t`This clears the shape and everything painted on it.`,
      confirmText: t({ message: "Start over", context: "confirm clearing the map builder" }),
      tone: "danger",
    });
    if (!ok) return;
    installDefault(islandsOn);
  }

  // Lay a fresh generated port set around the board's coast, from the given
  // port seed (or a fresh one), leaving the tiles alone.
  async function rerollHarbors(withSeed?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const { board: ported, seed: used } = await api.harborsMap(built, withSeed);
      setBoard(ported);
      if (used) {
        setPortSeed(used);
      }
    } catch (e) {
      setNotice(apiErrorText(e, t`Couldn't place harbours`));
    } finally {
      setBusy(false);
    }
  }

  async function removeMap(m: MapRow) {
    const name = m.name;
    const ok = await confirm({
      title: t`Delete this map?`,
      body: t`"${name}" will be removed from your library. This can't be undone.`,
      confirmText: t({ message: "Delete", context: "confirm deleting a saved map" }),
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteMap(m.id);
      void savedMaps.refetch();
    } catch (e) {
      setNotice(apiErrorText(e, t`Couldn't delete map`));
    }
  }

  async function save() {
    if (!name.trim() || !valid) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.saveMap(name.trim(), built);
      setNotice(t`Saved to your library.`);
      void savedMaps.refetch();
    } catch (e) {
      setNotice(apiErrorText(e, t`Save failed`));
    } finally {
      setBusy(false);
    }
  }

  async function play() {
    if (!valid) return;
    // Returning to the lobby we came from isn't abandoning it, so only the
    // create-new path needs the abandon warning.
    if (!source && !(await guard())) return;
    setBusy(true);
    setNotice(null);
    try {
      if (source) {
        // Patch the lobby's map in place along with the expansions chosen here
        // (the lobby's own set was loaded into the picker on arrival, so an
        // untouched picker hands back exactly what it was given).
        await api.updateConfig(source.id, {
          ...source.cfg,
          board: built,
          preset: "",
          ruleset,
          // Expansions carry VP premiums, so a changed set moves the target as
          // the lobby's switches do, unless the host set their own.
          target_vp: retargetVP(
            source.cfg.target_vp,
            source.cfg.players,
            source.cfg.ruleset,
            ruleset,
          ),
        });
        void navigate({ to: "/lobby", search: { g: source.id } });
        return;
      }
      // Passed in rather than spread over the result: defaultConfig derives
      // the VP target from the ruleset.
      const s = await api.createGame(
        defaultConfig({ players: seats, ruleset, board: built }),
        true,
      );
      void navigate({ to: "/lobby", search: { g: s.game.id } });
    } catch (e) {
      setNotice(
        apiErrorText(
          e,
          source ? t`Could not apply the map to your lobby` : t`Could not start a game`,
        ),
      );
      setBusy(false);
    }
  }

  function flashCopy(m: string) {
    setCopyMsg(m);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyMsg(null), 1800);
  }
  async function exportCode() {
    if (!valid) return;
    try {
      // Frame before encoding so the share code embeds the computed ocean; if
      // framing fails, use the raw board (the backend heals it at start).
      const framed = await frameForExport(built);
      const { code: c } = await api.encodeMap(framed);
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(c);
      flashCopy(t`Copied!`);
    } catch (e) {
      flashCopy(apiErrorText(e, t`Couldn't copy`));
    }
  }
  async function importCode() {
    const c = importText.trim();
    if (!c) return;
    setNotice(null);
    try {
      const { board: b } = await api.decodeMap(c);
      receiveBoard(b);
      setImportText("");
      setNotice(t`Loaded map from code.`);
    } catch {
      setNotice(t`That isn't a valid map code.`);
    }
  }

  if (!me) {
    return (
      <Screen>
        <SiteHeader active="mapbuilder" compact />
        <div className="text-center py-20">
          <div className="text-[18px] font-semibold mb-3">
            <Trans>Log in to build maps</Trans>
          </div>
          {/* /login escapes the Activity (and bounces on to /lobby), so the
              login affordance is web-only. In the Activity me is always set. */}
          {!inActivityMode() && (
            <Button asChild tone="discord">
              <Link to="/login">
                <Trans>Log in</Trans>
              </Link>
            </Button>
          )}
        </div>
      </Screen>
    );
  }

  // "3" or "5–6", with the digits in the player's own numbering.
  const playerRange =
    rec.min === rec.max
      ? formatNumber(rec.min)
      : `${formatNumber(rec.min)}–${formatNumber(rec.max)}`;
  const rollable = landCount >= 3;

  // The chosen expansions, named, for the collapsed picker's one-line summary.
  const chosen = groupedExpansions()
    .flatMap(([, entries]) => entries)
    .filter(([k]) => (k === "islands" ? islandsOn : exp[k]))
    .map(([, label]) => i18n._(label));

  const playLabel = source ? <Trans>Apply to lobby</Trans> : <Trans>Play this map</Trans>;
  const seeds: SeedControlsProps = {
    blanks,
    onRandomizeResources: () => void generate({ seed: randomSeed(), portSeed: "" }),
    disabled: !rollable,
    busy,
  };

  return (
    <Screen>
      <SiteHeader active="mapbuilder" compact />

      <PageBody>
        <PageTitle
          icon={<Path weight="bold" size={26} />}
          title={<Trans context="page title of the map editor">Map builder</Trans>}
          subtitle={
            <Trans>
              Pick expansions, paint a shape, generate a board, then play it or share it.
            </Trans>
          }
        />
        {/* On a phone the canvas comes first and sticks to the top while the
            controls scroll beneath (`max-sm:`), so the brush and board stay in
            reach; on a phone held sideways it is the sticky left column
            (`squat:`). Below 1100px otherwise it is one column. */}
        <div className="grid grid-cols-[250px_1fr_300px] gap-4 max-[1100px]:grid-cols-1 squat:grid-cols-2 squat:items-start">
          {/* Tools column: the editor's palettes portal in here, left of the
              canvas, with the roll under them. The roll sits here because a tab
              click can spend a seed, and the seed field should be beside the
              tab that spent it. The right column holds what is done with a
              finished map (preview, expansions, save, play, share). */}
          <div className="contents min-[1101px]:flex min-[1101px]:flex-col min-[1101px]:gap-3 min-[1101px]:sticky min-[1101px]:top-4 min-[1101px]:self-start squat:flex squat:flex-col squat:gap-3 squat:col-start-2 squat:row-start-1">
            <div ref={setToolsSlot} className="contents" />
            <GeneratePanel
              seeds={seeds}
              centerDesert={centerDesertOn}
              onCenterDesertChange={setCenterDesertOn}
              rollMode={rollMode}
              onRollModeChange={setRollMode}
            />
          </div>

          {/* Canvas column. */}
          <div
            className={cn(
              "bg-secondary-background border border-rim shadow-hard rounded-card p-3 flex flex-col gap-2 self-start min-[1101px]:sticky min-[1101px]:top-4",
              "max-sm:order-first max-sm:sticky max-sm:top-0 max-sm:z-10 max-sm:self-stretch max-sm:p-2",
              "squat:col-start-1 squat:row-start-1 squat:row-span-2 squat:sticky squat:top-2 squat:z-10 squat:p-2",
            )}
          >
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[17px] font-semibold mr-1">
                <Trans context="map builder canvas heading">Board</Trans>
              </div>
              <Button size="sm" variant="secondary" disabled={busy || !canUndo} onClick={undo}>
                <Trans>Undo</Trans>
              </Button>
              <Button size="sm" variant="secondary" disabled={busy || !canRedo} onClick={redo}>
                <Trans>Redo</Trans>
              </Button>
              <div className="ml-auto text-[12px] text-muted">
                {blanks ? (
                  <Trans>Blank land is filled by Generate.</Trans>
                ) : (
                  <Trans>Every tile is set. Paint over it, or Generate to roll again.</Trans>
                )}
              </div>
            </div>
            <DesignEditor
              board={built}
              onBoardChange={setBoard}
              issues={issues}
              highlightHexes={highlight}
              toolsSlot={toolsSlot}
              busy={busy}
              initialTool="shape"
              onToolChange={enterTool}
              allowGold={islandsOn}
              onReset={() => {
                void resetBoard();
              }}
              onStrokeStart={history.beginStroke}
              onStrokeEnd={history.endStroke}
            />
          </div>

          {/* Sidebar, in working order: preview, expansions, the roll, then
              Save / Play, then issues, then sharing. */}
          <div className="flex flex-col gap-3 squat:col-start-2 squat:row-start-2">
            {/* The preview: fullscreen, rolling the board first if needed. */}
            <Button
              variant="secondary"
              size="lg"
              className="w-full"
              disabled={busy || !valid}
              onClick={() => {
                void openPreview();
              }}
              data-testid="open-preview"
            >
              <Cube weight="bold" size={18} />
              <Trans>Preview in 3D</Trans>
            </Button>

            {/* The one filled action on the page: what the map is for. */}
            <Button
              size="lg"
              className="w-full"
              disabled={busy || !valid}
              onClick={() => {
                void play();
              }}
            >
              {playLabel}
            </Button>

            {/* expansions */}
            <div
              data-panel="expansions"
              className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-2"
            >
              <button
                type="button"
                aria-expanded={expOpen}
                onClick={() => setExpOpen((v) => !v)}
                className="flex items-center gap-2 text-left"
              >
                <span className="shrink-0 text-[12px] font-semibold text-muted">
                  <Trans context="map builder panel heading">Expansions</Trans>
                </span>
                {!expOpen && (
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                    {chosen.length ? formatList(chosen) : <Trans>Base game</Trans>}
                  </span>
                )}
                <CaretDown
                  weight="bold"
                  size={12}
                  className={`ml-auto shrink-0 text-muted transition-transform ${expOpen ? "rotate-180" : ""}`}
                />
              </button>
              {expOpen && (
                <>
                  <ExpansionShelf
                    exp={{ ...exp, islands: islandsOn }}
                    disabled={busy}
                    only={BUILDER_EXPANSIONS}
                    coreHeading={false}
                    onToggle={(key, on) => {
                      if (key === "islands") void switchIslands(!on);
                      else setExp((e) => ({ ...e, [key]: !on }));
                    }}
                  />
                  <div className="text-[13px] text-muted leading-[1.45]">
                    <Trans>
                      Only the expansions that change the map are here; they show in the preview and
                      are switched on for the table you open. Switching Islands on or off replaces
                      the board with that mode's default map. Knights and the rest are picked in the
                      lobby.
                    </Trans>
                  </div>
                </>
              )}
            </div>

            {/* validity + save/play */}
            <div className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-2">
              <div
                className={`text-[14px] font-semibold ${valid ? "text-green-ink" : "text-red-ink"}`}
              >
                {/* Two whole sentences: "islands" and "base" are adjectives
                  here and agree differently across languages. */}
                {landCount < 3 ? (
                  <Trans>Paint at least 3 land tiles</Trans>
                ) : !valid ? (
                  <Trans>Fix the errors below to play</Trans>
                ) : islandsOn ? (
                  <Trans>✓ Playable islands map</Trans>
                ) : (
                  <Trans>✓ Playable base map</Trans>
                )}
              </div>
              <div className="text-[12.5px] text-muted font-num tabular-nums">
                <Trans>
                  {tileCount} · best with {playerRange} players
                </Trans>
              </div>
              {blanks && valid && (
                <div className="text-[13px] text-muted leading-[1.45]">
                  <Trans>
                    Blank tiles are rolled at the table. Generate or Preview first to see the board
                    and keep it.
                  </Trans>
                </div>
              )}
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t`Map name`}
                maxLength={60}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !valid || !name.trim()}
                  onClick={() => {
                    void save();
                  }}
                >
                  <Trans context="save the map to your library">Save</Trans>
                </Button>
              </div>
              {notice && <div className="text-[12.5px] text-muted">{notice}</div>}
            </div>

            {/* lint warnings */}
            {rollable && <WarningsPanel issues={issues} onHighlight={setHighlight} />}

            {/* share a code */}
            <div className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-muted">
                  <Trans context="map builder panel heading">Share a code</Trans>
                </span>
                {copyMsg && (
                  <span className="text-[12px] font-semibold text-green-ink">{copyMsg}</span>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!valid}
                onClick={() => {
                  void exportCode();
                }}
              >
                <Trans>Copy map code</Trans>
              </Button>
              <div className="flex gap-2">
                <Input
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={t`Paste a map code`}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!importText.trim()}
                  onClick={() => {
                    void importCode();
                  }}
                >
                  <Trans context="load a map from a pasted code">Load</Trans>
                </Button>
              </div>
            </div>

            {/* saved maps library: only the current user's own maps */}
            {myMaps.length > 0 && (
              <div className="bg-secondary-background border border-rim shadow-hard rounded-card p-3.5 flex flex-col gap-1.5">
                <div className="text-[12px] font-semibold text-muted">
                  <Trans context="map builder panel heading">Your maps</Trans>
                </div>
                {myMaps.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 border-b border-line py-1.5 last:border-0"
                  >
                    <button
                      onClick={() => receiveBoard(m.board)}
                      className="flex-1 text-left text-[13.5px] font-semibold hover:text-blue-ink"
                    >
                      {m.name}{" "}
                      <span className="text-muted font-normal font-num tabular-nums">
                        ·{" "}
                        <Trans context="map size, r = board radius in rings, compact">
                          r{m.board.radius}
                        </Trans>
                      </span>
                    </button>
                    <button
                      data-deletemap={m.id}
                      aria-label={t`Delete map ${m.name}`}
                      onClick={() => {
                        void removeMap(m);
                      }}
                      className="shrink-0 w-6 h-6 rounded-md text-[15px] leading-none text-muted hover:text-red-ink hover:bg-red-tint"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageBody>

      {previewOpen && (
        <PreviewOverlay
          preview={preview}
          ruleset={ruleset}
          seeds={seeds}
          busy={busy}
          playLabel={playLabel}
          playDisabled={!valid}
          onPlay={() => {
            void play();
          }}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </Screen>
  );
}
