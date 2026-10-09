import * as React from "react";
import { assetURL, slotUntitled } from "@/lib/assets";
import { goodIconSlot } from "@/lib/resourceArt";
import { slotCardTitle } from "@/lib/cardText";
import { currentLocale } from "@/lib/i18n";
import { useLingui } from "@/lib/linguiRuntime";
import { CardTitlePlate } from "./CardTitlePlate";

// Resolve a slot to a URL only once the image has loaded. A missing slot, a 404
// or an undecodable file yields null, and the consumer draws nothing rather than
// a broken-image icon. Every slot is baked and committed, so a hole means the
// pack lost a file; no stand-in hides it.
//
// URLs that decoded this session are cached, so a remount shows the asset on
// its first render; only the first load of each URL waits.
const validatedURLs = new Set<string>();

function useVerifiedAsset(slot: string): string | null {
  const url = assetURL(slot);
  const [okURL, setOkURL] = React.useState<string | null>(() =>
    url && validatedURLs.has(url) ? url : null,
  );
  React.useEffect(() => {
    if (!url) {
      setOkURL(null);
      return;
    }
    if (validatedURLs.has(url)) {
      setOkURL(url);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      validatedURLs.add(url);
      if (alive) setOkURL(url);
    };
    img.onerror = () => {
      if (alive) setOkURL(null);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return okURL;
}

// DOM icon (resource pill replacement).
//
// `fallback` is for running text (log lines), where a missing icon would leave
// the sentence without its object; those callers pass the name.
//
// `className` is for non-square art, such as the 256x340 card back in the
// flight layer.
export function ResIcon({
  slot,
  size = 20,
  fallback = null,
  className,
}: {
  slot: string;
  size?: number;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const url = useVerifiedAsset(slot);
  return url ? (
    <img src={url} width={size} height={size} className={className} alt="" />
  ) : (
    <>{fallback}</>
  );
}

/**
 * A good's picture at icon size, by id (`rivercoin`, `gold`, `fish`...).
 *
 * A good whose render is baked into the pack draws that image, and nothing
 * while it loads. A good with no slot in the pack draws `fallback`, which for
 * it is the only art there is (the HUD glyph), not a stand-in. See
 * lib/resourceArt.
 */
export function GoodIcon({
  id,
  size = 16,
  fallback = null,
  className,
}: {
  id: string;
  size?: number;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const slot = goodIconSlot(id);
  if (!slot) return <>{fallback}</>;
  return <ResIcon slot={slot} size={size} className={className ?? "object-contain"} />;
}

// Card face. Nothing is drawn until the face has loaded; `fallback` is only for
// diagnostics (the dev gallery marks a slot the pack lacks).
//
// Art with an English title baked in renders as a bare `<img>`. Untitled
// masters are wrapped, with the title plate drawn in the player's language
// (lib/cardTitle). Both kinds coexist while the set is converted.
//
// The wrapper takes the caller's className and keeps the 5:7 card aspect, so
// width-sized call sites (`w-[104px] h-auto`) keep their geometry.
export function CardFace({
  slot,
  fallback = null,
  className,
}: {
  slot: string;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const url = useVerifiedAsset(slot);
  // Re-render on locale changes; the title is a live getter.
  useLingui();
  const title = slotUntitled(slot) ? slotCardTitle(slot) : null;

  if (!url) return <>{fallback}</>;
  if (!title) return <img src={url} className={className} alt="" />;
  return (
    <span className={`relative block aspect-[5/7] overflow-hidden ${className ?? ""}`}>
      <img src={url} className="absolute inset-0 block h-full w-full object-cover" alt="" />
      <CardTitlePlate title={title} locale={currentLocale()} />
    </span>
  );
}
