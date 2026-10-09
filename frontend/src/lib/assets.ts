// The asset registry: which slots the game draws and plays, and where each
// one's file lives.
//
// File locations come from the baked pack's `public/assets/manifest.json`,
// which names each slot's extension. It is imported rather than fetched, so
// resolution is synchronous and works on the first render.
import manifest from "../../public/assets/manifest.json";
import heroPicks from "./resourceArt.json";

/**
 * What a slot is for.
 *
 * There is no kind for the board: tiles, pieces and the robber are models in
 * `public/models`, loaded by board3d. This registry covers the flat art with no
 * model behind it (resource icons, the dev-card back) plus sounds.
 */
export type SlotKind = "icon" | "card" | "sound";

export interface SlotDef {
  id: string;
  kind: SlotKind;
}

function img(id: string, kind: SlotKind): SlotDef {
  return { id, kind };
}
function snd(id: string): SlotDef {
  return { id, kind: "sound" };
}

export const SLOTS: SlotDef[] = [
  // Resource icons
  img("icon_wood", "icon"),
  img("icon_brick", "icon"),
  img("icon_sheep", "icon"),
  img("icon_wheat", "icon"),
  img("icon_ore", "icon"),
  // Commodity icons (Knights expansion)
  img("icon_cloth", "icon"),
  img("icon_paper", "icon"),
  img("icon_coin", "icon"),
  // Baked renders from the pick map (lib/resourceArt.json): a small icon and a
  // card-sized one per good. The resources and commodities above already have
  // icon slots; every other good (Rivers coins, Raiders gold, ...) gets one
  // here, and every good gets a card slot. Derived from the pick map so a new
  // good needs no second edit. A good on "shipped" adds no slot.
  ...Object.entries(heroPicks.items as Record<string, unknown>)
    .filter(([, pick]) => pick !== "shipped")
    .map(([id]) => id)
    .flatMap((id) => [
      ...(["wood", "brick", "sheep", "wheat", "ore", "cloth", "paper", "coin"].includes(id)
        ? []
        : [img(`icon_${id}`, "icon")]),
      img(`card_${id}`, "icon"),
    ]),
  // Dev cards.
  img("devcard_knight", "card"),
  img("devcard_victorypoint", "card"),
  img("devcard_roadbuilding", "card"),
  img("devcard_yearofplenty", "card"),
  img("devcard_monopoly", "card"),
  img("devcard_back", "card"),
  // Knights progress cards, keyed by the wire id the server sends
  // (engine/knights/progress.go).
  img("progress_commercial_harbor", "card"),
  img("progress_master_merchant", "card"),
  img("progress_merchant", "card"),
  img("progress_merchant_fleet", "card"),
  img("progress_resource_monopoly", "card"),
  img("progress_trade_monopoly", "card"),
  img("progress_bishop", "card"),
  img("progress_constitution", "card"),
  img("progress_deserter", "card"),
  img("progress_diplomat", "card"),
  img("progress_intrigue", "card"),
  img("progress_saboteur", "card"),
  img("progress_spy", "card"),
  img("progress_warlord", "card"),
  img("progress_wedding", "card"),
  img("progress_alchemist", "card"),
  img("progress_crane", "card"),
  img("progress_engineer", "card"),
  img("progress_inventor", "card"),
  img("progress_irrigation", "card"),
  img("progress_medicine", "card"),
  img("progress_mining", "card"),
  img("progress_printer", "card"),
  img("progress_road_building", "card"),
  img("progress_smith", "card"),
  // Raiders replaces the base dev deck with these four (engine/raiders/raiders.go
  // sets NoDevCards). Keyed by wire id (engine/raiders/events.go), prefixed
  // because `intrigue` is also a Knights progress card and both can share a hand.
  img("raiders_muster", "card"),
  img("raiders_swift_rider", "card"),
  img("raiders_treason", "card"),
  img("raiders_intrigue", "card"),
  // Wagons keeps the base five faces and adds one of its own.
  img("devcard_swiftjourney", "card"),
  // Sounds. One placement sample covers every piece (pitch-shifted per piece
  // type); most events are silent.
  snd("sound_music"),
  snd("sound_start"),
  snd("sound_turn"),
  snd("sound_place"),
  snd("sound_dice-0"),
  snd("sound_dice-1"),
  snd("sound_dice-2"),
  snd("sound_dice-3"),
  snd("sound_dice-4"),
  snd("sound_knight_ready"),
  snd("sound_upgrade"),
  snd("sound_seven"),
  snd("sound_barbarians"),
  snd("sound_win"),
  snd("sound_lose"),
];

export type SlotId = (typeof SLOTS)[number]["id"];

const BY_ID = new Map(SLOTS.map((s) => [s.id, s]));
export function slotDef(id: string): SlotDef | undefined {
  return BY_ID.get(id);
}

/** Every slot expected to have a committed image in the pack. */
export const ART_SLOT_IDS: SlotId[] = SLOTS.filter((s) => s.kind !== "sound").map((s) => s.id);

type SlotEntry = { ext?: string; untitled?: boolean };
const ENTRIES = manifest.slots as Record<string, SlotEntry>;

const EXT: Record<string, string> = Object.fromEntries(
  Object.entries(ENTRIES).flatMap(([slot, e]) =>
    typeof e?.ext === "string" ? [[slot, e.ext] as [string, string]] : [],
  ),
);

/**
 * Whether this slot's baked file has no title in its pixels.
 *
 * Cards with an untitled master ship that render and get their name drawn at
 * runtime in the player's language. Cards still on older art keep the English
 * title baked in, so the flag is per slot until the render batch finishes.
 */
export function slotUntitled(slot: string): boolean {
  return ENTRIES[slot]?.untitled === true;
}

/** The extension this slot was baked to, or null if the pack has no file for it. */
export function assetExt(slot: string): string | null {
  return EXT[slot] ?? null;
}

/**
 * The URL of a slot's file, or null if the pack has none.
 *
 * A few slots (the music) are intentionally unbaked and drawn by their
 * consumers. Anything else returning null means the pack lost a file; the sound
 * and manifest tests check for that.
 */
export function assetURL(slot: string): string | null {
  const ext = assetExt(slot);
  return ext ? `/assets/${slot}.${ext}` : null;
}
