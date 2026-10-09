// Dev-only: every UI element in every state, for style review. Mounted at
// /dev/gallery (optionally ?section=primitives|site|hud|game).
import * as Primitives from "./sections/primitives";
import * as Site from "./sections/site";
import * as Hud from "./sections/hud";
import * as GameSection from "./sections/game";
import * as Expansions from "./sections/expansions";

const SECTIONS = {
  primitives: Primitives,
  site: Site,
  hud: Hud,
  game: GameSection,
  expansions: Expansions,
} as const;

export function Gallery() {
  const want = new URLSearchParams(window.location.search).get("section");
  const list = Object.entries(SECTIONS).filter(([k]) => !want || k === want);
  return (
    <div className="flex flex-col gap-10 p-6" data-gallery>
      {list.map(([key, mod]) => (
        <div key={key} data-section={key} className="flex flex-col gap-6">
          <h2 className="text-[22px] font-display text-on-background">{mod.title}</h2>
          <mod.Section />
        </div>
      ))}
    </div>
  );
}
